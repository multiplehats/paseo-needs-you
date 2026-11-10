import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { PROVIDERS } from "./jev";

const ProviderSchema = z.enum(PROVIDERS);
const VerdictSchema = z.enum(["question", "action", "offer", "none"]);

export const judgeRpc = defineRpc({
  name: "detection.judge",
  input: z.object({ text: z.string().max(500_000), request: z.string().max(500_000).nullable() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("judged"), verdict: VerdictSchema, provider: ProviderSchema }),
    // No provider set up: the client uses the text rules, and that is not a problem.
    z.object({ status: z.literal("off") }),
    z.object({ status: z.literal("failed"), error: z.string() }),
  ]),
});

const DetectionStatusSchema = z.object({
  provider: ProviderSchema.nullable(),
  keySource: z.enum(["saved", "environment"]).nullable(),
});
export type DetectionStatus = z.infer<typeof DetectionStatusSchema>;

export const statusRpc = defineRpc({
  name: "detection.status",
  input: z.object({}),
  output: DetectionStatusSchema,
});

/** The key only ever travels towards the host. No call returns it. */
export const saveRpc = defineRpc({
  name: "detection.save",
  input: z.object({
    provider: ProviderSchema.nullable(),
    key: z.string().trim().min(1).max(1_000).optional(),
  }),
  output: DetectionStatusSchema,
});

export const testRpc = defineRpc({
  name: "detection.test",
  input: z.object({}),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), verdict: VerdictSchema }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
});
