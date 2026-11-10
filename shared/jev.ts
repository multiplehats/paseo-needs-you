// Every word sent to the decision model, the thresholds, and where each provider serves it.
// Jev makes the judgments; decide() below turns them into a verdict.
import type { Verdict } from "./verdict";

export const PROVIDERS = ["openrouter", "vercel", "typesafe"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface ProviderInfo {
  label: string;
  url: string;
  model: string;
  /** Read from the host's environment when no key has been saved in Settings. */
  env: string;
}

export const PROVIDER_INFO: Record<Provider, ProviderInfo> = {
  openrouter: {
    label: "OpenRouter",
    url: "https://openrouter.ai/api/v1/systemone",
    model: "~typesafe/jev-latest",
    env: "OPENROUTER_API_KEY",
  },
  vercel: {
    label: "Vercel AI Gateway",
    url: "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
    model: "typesafe-ai/jev",
    env: "AI_GATEWAY_API_KEY",
  },
  typesafe: {
    label: "TypeSafe",
    url: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    env: "TYPESAFE_API_KEY",
  },
};

export const QUESTIONS = {
  asks_question: {
    type: "noul",
    instructions:
      "Does `agent_message` directly ask the person a question the agent wants answered?",
    criteria: {
      true: "It puts a question to the person, such as whether to go ahead or which option they want",
      false: "It only states results, findings or leftovers, even when it mentions open issues",
    },
  },
  asks_action: {
    type: "noul",
    instructions:
      "Does `agent_message` ask the person to do something themselves before the agent can continue?",
    criteria: {
      true: "The person has to act first, such as run a command, supply a token or review something",
      false: "The agent has finished, or will carry on by itself or with other agents",
    },
  },
  offers_more: {
    type: "noul",
    instructions: "Does `agent_message` offer extra work that the person can accept or ignore?",
    criteria: {
      true: "The agent proposes something more it could do if the person wants it",
      false: "The agent proposes no further work",
    },
  },
} as const;

/** Jev's context is about 32k tokens per question, and the end of a message is what matters. */
const MAX_MESSAGE_CHARS = 20_000;

export function buildRequest(model: string, message: string) {
  return {
    model,
    state: { agent_message: message.slice(-MAX_MESSAGE_CHARS) },
    questions: QUESTIONS,
  };
}

export interface Judgments {
  asks: number;
  acts: number;
  offers: number;
}

function noul(answers: Record<string, { noul?: unknown } | undefined>, name: string) {
  const value = answers[name]?.noul;
  if (typeof value !== "number") throw new Error(`The model gave no answer for ${name}.`);
  return value;
}

/** The three probabilities out of a response. A malformed one throws: it is not a "no". */
export function readAnswers(body: unknown): Judgments {
  const answers = (body as { answers?: Record<string, { noul?: unknown }> } | null)?.answers;
  if (!answers || typeof answers !== "object") throw new Error("The model returned no answers.");
  return {
    asks: noul(answers, "asks_question"),
    acts: noul(answers, "asks_action"),
    offers: noul(answers, "offers_more"),
  };
}

/** Below this reads as a clear no. Anything unsettled is listed, because a miss costs more. */
export const THRESHOLD = 0.3;
/** An offer can wait, and agents make plenty of them, so it has to be a clear one. */
export const OFFER_THRESHOLD = 0.5;

export function decide({ asks, acts, offers }: Judgments): Verdict {
  if (asks >= THRESHOLD) return "question";
  if (acts >= THRESHOLD) return "action";
  if (offers >= OFFER_THRESHOLD) return "offer";
  return "none";
}

/** A message with a known answer, for the Test button in Settings. */
export const TEST_MESSAGE =
  "The migration is ready. Should I run it on production now, or wait until tonight?";
