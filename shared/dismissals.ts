import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// A dismissal is tied to what was dismissed: when the agent says something new it comes back.
export const DismissalsSchema = z.object({
  /** `serverId:agentId` → the dismissed entry's fingerprint and when it was dismissed. */
  dismissed: z.record(z.string(), z.object({ print: z.string(), at: z.number() })).default({}),
});
export type Dismissals = z.infer<typeof DismissalsSchema>;

// Kept on the host so that dismissing on one device clears it on the others.
export const dismissalSettings = defineSettings({
  id: "dismissals",
  scope: "host",
  version: 1,
  schema: DismissalsSchema,
});

export const emptyDismissals = (): Dismissals => ({ dismissed: {} });

const MAX_DISMISSALS = 500;

export function isDismissed(doc: Dismissals, key: string, print: string) {
  return doc.dismissed[key]?.print === print;
}

export function addDismissal(doc: Dismissals, key: string, print: string, at: number): Dismissals {
  const entries = Object.entries({ ...doc.dismissed, [key]: { print, at } });
  entries.sort(([, a], [, b]) => b.at - a.at);
  return { dismissed: Object.fromEntries(entries.slice(0, MAX_DISMISSALS)) };
}

/** Both devices' dismissals; for one agent dismissed on both, the later one stands. */
export function mergeDismissals(a: Dismissals, b: Dismissals): Dismissals {
  const dismissed = { ...a.dismissed };
  for (const [key, entry] of Object.entries(b.dismissed))
    if (!dismissed[key] || dismissed[key].at < entry.at) dismissed[key] = entry;
  return { dismissed };
}
