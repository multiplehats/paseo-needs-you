// What this plugin needs from a connected host's Paseo API, and how to read it. The app hands
// out one API per host through getPaseoClient(serverId); tests pass small fakes of the same shape.

export interface HostPermission {
  id: string;
  kind: string;
  name: string;
  title?: string;
  description?: string;
}

export interface HostAgent {
  id: string;
  status: string;
  title: string | null;
  updatedAt: string;
  labels: Readonly<Record<string, string>>;
  archivedAt?: string | null;
  attentionReason?: string | null;
  lastError?: string;
  pendingPermissions: readonly HostPermission[];
}

export interface HostPlacement {
  projectName: string;
}

export interface HostEntry {
  agent: HostAgent;
  project: HostPlacement | null;
}

export type HostAgentUpdate =
  | { kind: "upsert"; agent: HostAgent; project: HostPlacement | null }
  | { kind: "remove"; agentId: string };

export type TimelineItem = { type: string; text?: string };

export interface TailOptions {
  direction: "tail";
  limit: number;
  projection: "projected";
}

export interface ListOptions {
  filter: { includeArchived: boolean };
  sort: { key: "updated_at"; direction: "desc" }[];
  page: { limit: number };
}

export interface HostApi {
  agents: {
    list(options: ListOptions): Promise<{ entries: readonly HostEntry[] }>;
    subscribe(handler: (update: HostAgentUpdate) => void): () => void;
    ref(agentId: string): {
      timeline: {
        refetch(options: TailOptions): Promise<{ entries: readonly { item: TimelineItem }[] }>;
      };
    };
  };
}

export type HostLookup = (serverId: string) => HostApi;

/** Set on agents another agent started: they report to that agent, not to the person. */
const PARENT_LABEL = "paseo.parent-agent-id";

export type Flag =
  | { kind: "permission"; excerpt: string; print: string }
  | { kind: "failed"; excerpt: string; print: string };

export type Assessment = { kind: "skip" } | { kind: "read" } | ({ kind: "flag" } & { flag: Flag });

function permissionExcerpt(request: HostPermission | undefined) {
  if (!request) return "Waiting for your approval.";
  const what = request.title || request.description || request.name;
  return request.kind === "question" ? what : `Waiting for your approval: ${what}`;
}

/** What is known from the agent's own state, before reading what it said. */
export function assess(agent: HostAgent): Assessment {
  if (agent.archivedAt || agent.status === "closed") return { kind: "skip" };
  const request = agent.pendingPermissions[0];
  // A blocked agent is blocked whoever started it, so this comes before the parent check.
  if (request || agent.attentionReason === "permission")
    return {
      kind: "flag",
      flag: {
        kind: "permission",
        excerpt: permissionExcerpt(request),
        print: `permission-${request?.id ?? agent.updatedAt}`,
      },
    };
  if (agent.labels[PARENT_LABEL]) return { kind: "skip" };
  if (agent.status === "error" || agent.attentionReason === "error")
    return {
      kind: "flag",
      flag: {
        kind: "failed",
        excerpt: agent.lastError || "The agent stopped with an error.",
        print: `failed-${agent.lastError ?? agent.updatedAt}`,
      },
    };
  return agent.status === "idle" ? { kind: "read" } : { kind: "skip" };
}

/** The agent's last message, unless the person has spoken since. */
export function lastAgentMessage(entries: readonly { item: TimelineItem }[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const { type, text } = entries[i].item;
    if (type === "user_message") return null;
    if (type === "assistant_message" && text?.trim()) return text;
  }
  return null;
}

/** "3m", "2h", "5d": how long ago, for a list row. */
export function ago(iso: string, now: number) {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
