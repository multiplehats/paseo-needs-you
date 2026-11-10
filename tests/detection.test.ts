import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDetection } from "../server/detection";
import { defaultKeyPath, fileKeyStore, type KeyStore, type SavedDetection } from "../server/keys";

const exchange = { text: "Should I ship it?", request: null };
const SECRET = "sk-very-secret";

function memoryKeys(initial: SavedDetection = { provider: null, keys: {} }): KeyStore {
  let saved = initial;
  return { read: async () => saved, write: async (next) => void (saved = next) };
}

function fakeFetch(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const answered = (asks: number) => () =>
  Response.json({
    answers: {
      asks_question: { noul: asks },
      asks_action: { noul: 0 },
      offers_more: { noul: 0 },
    },
  });

const openrouter = () => memoryKeys({ provider: "openrouter", keys: { openrouter: SECRET } });

test("with no provider nothing is sent", async () => {
  const { calls, fetch } = fakeFetch(answered(1));
  const lines: string[] = [];
  const detection = createDetection({ keys: memoryKeys(), fetch, log: (l) => lines.push(l) });
  assert.deepEqual(await detection.judge(exchange), { status: "off" });
  await detection.judge(exchange);
  assert.equal(calls.length, 0);
  assert.equal(lines.length, 1, "says so once");
});

test("a provider with no key is off too", async () => {
  const { calls, fetch } = fakeFetch(answered(1));
  const keys = memoryKeys({ provider: "vercel", keys: {} });
  const detection = createDetection({ keys, env: {}, fetch, log: () => {} });
  assert.equal((await detection.judge(exchange)).status, "off");
  assert.deepEqual(await detection.status(), { provider: "vercel", keySource: null });
  assert.equal(calls.length, 0);
});

test("each provider is called at its own address with the key and its model name", async () => {
  const expected = {
    openrouter: ["https://openrouter.ai/api/v1/systemone", "~typesafe/jev-latest"],
    vercel: ["https://ai-gateway.vercel.sh/typesafe/v1/systemone", "typesafe-ai/jev"],
    typesafe: ["https://api.typesafe.ai/v1/systemone", "jev-latest"],
  } as const;
  for (const [provider, [url, model]] of Object.entries(expected)) {
    const { calls, fetch } = fakeFetch(answered(0.9));
    const keys = memoryKeys({ provider: provider as "vercel", keys: { [provider]: SECRET } });
    const detection = createDetection({ keys, env: {}, fetch, log: () => {} });
    assert.deepEqual(await detection.judge(exchange), {
      status: "judged",
      verdict: "question",
      provider,
    });
    assert.equal(calls[0].url, url);
    assert.equal(
      (calls[0].init.headers as Record<string, string>).Authorization,
      `Bearer ${SECRET}`,
    );
    assert.equal(JSON.parse(String(calls[0].init.body)).model, model);
  }
});

test("a key from the environment is used, and reported as such", async () => {
  const { calls, fetch } = fakeFetch(answered(0));
  const keys = memoryKeys({ provider: "openrouter", keys: {} });
  const env = { OPENROUTER_API_KEY: "env-key" };
  const detection = createDetection({ keys, env, fetch, log: () => {} });
  assert.deepEqual(await detection.status(), { provider: "openrouter", keySource: "environment" });
  assert.deepEqual(await detection.judge(exchange), {
    status: "judged",
    verdict: "none",
    provider: "openrouter",
  });
  assert.match(String((calls[0].init.headers as Record<string, string>).Authorization), /env-key/);
});

test("the same message is paid for once, even when asked at the same moment", async () => {
  const { calls, fetch } = fakeFetch(answered(0.9));
  const detection = createDetection({ keys: openrouter(), fetch, log: () => {} });
  await Promise.all([detection.judge(exchange), detection.judge(exchange)]);
  await detection.judge(exchange);
  assert.equal(calls.length, 1);
});

test("a failure is reported, not read as no, and is tried again next time", async () => {
  let up = false;
  const { calls, fetch } = fakeFetch(() =>
    up ? answered(0.9)() : new Response("nope", { status: 500 }),
  );
  const detection = createDetection({ keys: openrouter(), fetch, log: () => {} });
  const failed = await detection.judge(exchange);
  assert.equal(failed.status, "failed");
  up = true;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await detection.judge(exchange)).status, "judged");
  assert.equal(calls.length, 2);
});

test("errors name the problem and never contain the key", async () => {
  for (const [status, pattern] of [
    [401, /rejected the key/],
    [402, /out of credit/],
    [429, /rate limiting/],
    [503, /503/],
  ] as const) {
    const { fetch } = fakeFetch(() => new Response(SECRET, { status }));
    const detection = createDetection({ keys: openrouter(), fetch, log: () => {} });
    const result = await detection.judge(exchange);
    assert.ok(result.status === "failed");
    assert.match(result.error, pattern);
    assert.ok(!result.error.includes(SECRET));
  }
});

test("a malformed answer is a failure", async () => {
  const { fetch } = fakeFetch(() => Response.json({ answers: {} }));
  const detection = createDetection({ keys: openrouter(), fetch, log: () => {} });
  assert.equal((await detection.judge(exchange)).status, "failed");
});

test("the log has numbers and never the message or key", async () => {
  const lines: string[] = [];
  const { fetch } = fakeFetch(answered(0.9));
  const detection = createDetection({ keys: openrouter(), fetch, log: (l) => lines.push(l) });
  await detection.judge({ text: "Private customer detail?", request: "Secret request" });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /question/);
  assert.ok(!/Private|Secret|sk-very/.test(lines[0]));
});

test("saving keeps other providers' keys, and status never returns a key", async () => {
  const keys = memoryKeys();
  const detection = createDetection({ keys, env: {}, log: () => {} });
  await detection.save({ provider: "openrouter", key: SECRET });
  const status = await detection.save({ provider: "vercel", key: "other" });
  assert.deepEqual(status, { provider: "vercel", keySource: "saved" });
  assert.ok(!JSON.stringify(status).includes(SECRET));
  assert.deepEqual((await keys.read()).keys, { openrouter: SECRET, vercel: "other" });
});

test("switching to rules keeps the keys and turns the calls off", async () => {
  const keys = openrouter();
  const { calls, fetch } = fakeFetch(answered(1));
  const detection = createDetection({ keys, fetch, env: {}, log: () => {} });
  await detection.save({ provider: null });
  assert.equal((await detection.judge(exchange)).status, "off");
  assert.equal(calls.length, 0);
  assert.equal((await keys.read()).keys.openrouter, SECRET);
});

test("the test call asks the model for real and ignores the cache", async () => {
  const { calls, fetch } = fakeFetch(answered(0.9));
  const detection = createDetection({ keys: openrouter(), fetch, log: () => {} });
  assert.deepEqual(await detection.test(), { ok: true, verdict: "question" });
  await detection.test();
  assert.equal(calls.length, 2);
});

test("the test call says when there is no key", async () => {
  const detection = createDetection({ keys: memoryKeys(), env: {}, log: () => {} });
  assert.equal((await detection.test()).ok, false);
});

test("the key file is private to the user and survives a reload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "needs-you-"));
  const path = join(dir, "nested", "keys.json");
  await fileKeyStore(path).write({ provider: "vercel", keys: { vercel: SECRET } });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, "nested"))).mode & 0o777, 0o700);
  assert.deepEqual(await fileKeyStore(path).read(), {
    provider: "vercel",
    keys: { vercel: SECRET },
  });
  assert.ok((await readFile(path, "utf8")).includes(SECRET));
});

test("a missing or corrupt key file reads as nothing set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "needs-you-"));
  assert.deepEqual(await fileKeyStore(join(dir, "none.json")).read(), { provider: null, keys: {} });
});

test("the key file follows the Paseo home", () => {
  assert.equal(defaultKeyPath({ PASEO_HOME: "/x" }), "/x/plugin-secrets/needs-you.json");
});
