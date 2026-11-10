import { createHash } from "node:crypto";
import {
  buildRequest,
  decide,
  type Exchange,
  type Provider,
  PROVIDER_INFO,
  readAnswers,
  TEST_EXCHANGE,
} from "../shared/jev";
import type { DetectionStatus } from "../shared/rpc";
import type { Verdict } from "../shared/verdict";
import type { KeyStore } from "./keys";

export interface DetectionOptions {
  keys: KeyStore;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  timeoutMs?: number;
}

interface Active {
  provider: Provider;
  key: string;
}

const MAX_CACHED = 500;

function problem(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "The model could not be reached.";
}

function describeFailure(provider: Provider, status: number) {
  const { label } = PROVIDER_INFO[provider];
  if (status === 401 || status === 403) return `${label} rejected the key.`;
  if (status === 402) return `${label} says the account is out of credit.`;
  if (status === 429) return `${label} is rate limiting these requests.`;
  return `${label} returned an error (${status}).`;
}

export function createDetection({
  keys,
  env = process.env,
  fetch: request = fetch,
  log = (line) => console.log(line),
  timeoutMs = 15_000,
}: DetectionOptions) {
  // Phone and desktop both ask about the same message; it should only be paid for once.
  const cache = new Map<string, Promise<Verdict>>();
  let saidOff = false;

  async function active(): Promise<Active | null> {
    const saved = await keys.read();
    if (!saved.provider) return null;
    const key = saved.keys[saved.provider] ?? env[PROVIDER_INFO[saved.provider].env];
    return key ? { provider: saved.provider, key } : null;
  }

  async function ask({ provider, key }: Active, exchange: Exchange): Promise<Verdict> {
    const info = PROVIDER_INFO[provider];
    const response = await request(info.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildRequest(info.model, exchange)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(describeFailure(provider, response.status));
    const judgments = readAnswers(await response.json());
    const verdict = decide(judgments);
    // Numbers only: the message itself never goes in the plugin log.
    log(
      `judged via ${provider}: ${verdict} (asks ${judgments.asks.toFixed(2)}, acts ` +
        `${judgments.acts.toFixed(2)}, offers ${judgments.offers.toFixed(2)})`,
    );
    return verdict;
  }

  function cached(config: Active, exchange: Exchange) {
    const id = createHash("sha256")
      .update(JSON.stringify([config.provider, exchange.text, exchange.request]))
      .digest("hex");
    let answer = cache.get(id);
    if (!answer) {
      answer = ask(config, exchange);
      cache.set(id, answer);
      // A failure must be retried later, not remembered.
      answer.catch(() => cache.delete(id));
      if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
    }
    return answer;
  }

  async function status(): Promise<DetectionStatus> {
    const saved = await keys.read();
    if (!saved.provider) return { provider: null, keySource: null };
    if (saved.keys[saved.provider]) return { provider: saved.provider, keySource: "saved" };
    const fromEnvironment = Boolean(env[PROVIDER_INFO[saved.provider].env]);
    return { provider: saved.provider, keySource: fromEnvironment ? "environment" : null };
  }

  return {
    status,
    async judge(exchange: Exchange) {
      const config = await active();
      if (!config) {
        if (!saidOff) log("no model set up: using the text rules");
        saidOff = true;
        return { status: "off" as const };
      }
      saidOff = false;
      try {
        const verdict = await cached(config, exchange);
        return { status: "judged" as const, verdict, provider: config.provider };
      } catch (error) {
        log(`judging failed: ${problem(error)}`);
        return { status: "failed" as const, error: problem(error) };
      }
    },
    async save(input: { provider: Provider | null; key?: string }) {
      const saved = await keys.read();
      const next = {
        provider: input.provider,
        keys:
          input.provider && input.key ? { ...saved.keys, [input.provider]: input.key } : saved.keys,
      };
      await keys.write(next);
      cache.clear();
      return status();
    },
    async test() {
      const config = await active();
      if (!config) return { ok: false as const, error: "Choose a provider and add its key first." };
      try {
        return { ok: true as const, verdict: await ask(config, TEST_EXCHANGE) };
      } catch (error) {
        return { ok: false as const, error: problem(error) };
      }
    },
  };
}
