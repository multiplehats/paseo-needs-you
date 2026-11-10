import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  addDismissal,
  dismissalSettings,
  DismissalsSchema,
  emptyDismissals,
  isDismissed,
  mergeDismissals,
} from "../shared/dismissals";
import type { Provider } from "../shared/jev";
import { judgeRpc, statusRpc } from "../shared/rpc";
import { excerpt, fingerprint, ruleVerdict, type Verdict } from "../shared/verdict";
import {
  assess,
  displayTitle,
  type HostAgentUpdate,
  type HostEntry,
  type HostLookup,
  lastAgentMessage,
  type ListOptions,
  sidebarKey,
} from "./hosts";

export type ItemKind = "permission" | "question" | "action" | "offer" | "failed";

export interface Item {
  /** `serverId:agentId`. */
  key: string;
  serverId: string;
  agentId: string;
  workspaceId: string | null;
  projectId: string | null;
  kind: ItemKind;
  title: string;
  project: string | null;
  hostLabel: string;
  excerpt: string;
  print: string;
  at: string;
}

export interface Snapshot {
  status: "loading" | "ready";
  items: readonly Item[];
  /** The model making the calls, or null when the text rules are. */
  provider: Provider | null;
  /** Why something is degraded right now; null when all is well. */
  problem: string | null;
}

export interface HostSummary {
  serverId: string;
  label: string;
  status: string;
}

export interface StoreOptions {
  rpc: PluginClientContext["rpc"];
  lookup: HostLookup;
  now?: () => number;
}

/** Enough to reach back past a long run of tool calls to the last thing said. */
const TAIL_ITEMS = 60;
const LIST: ListOptions = {
  filter: { includeArchived: false },
  sort: [{ key: "updated_at", direction: "desc" }],
  page: { limit: 200 },
};
const READS_AT_ONCE = 4;
/** A failed model call falls back to the rules at once, and is tried again after this long. */
const RETRY_MS = 5 * 60_000;

type Found = Pick<Item, "kind" | "excerpt" | "print"> | null;

interface Host {
  label: string;
  online: boolean;
  entries: Map<string, HostEntry>;
  stop: (() => void) | null;
}

/** The last look at an agent. `stamp` says which state of the agent it describes. */
interface Seen {
  stamp: string;
  found: Found;
  retryAt: number | null;
}

export type Store = ReturnType<typeof createStore>;

export function createStore({ rpc, lookup, now = Date.now }: StoreOptions) {
  const contract = settingsRpc(dismissalSettings.id);
  const listeners = new Set<() => void>();
  const hosts = new Map<string, Host>();
  const seen = new Map<string, Seen>();
  /** `key:print` → verdict, so a message is judged once however often the agent changes. */
  const judged = new Map<string, Verdict>();
  const reading = new Map<string, string>();
  const queue: (() => Promise<void>)[] = [];
  let running = 0;
  let dismissals = emptyDismissals();
  let revision: string | null = null;
  let writes: Promise<unknown> = Promise.resolve();
  let writing = 0;
  // Hosts have been reported and listed, and every first read is done: an empty list is real.
  let hostsKnown = false;
  let listed = false;
  let ready = false;
  let provider: Provider | null = null;
  let problem: string | null = null;
  let stopped = false;
  let snapshot: Snapshot = { status: "loading", items: [], provider: null, problem: null };

  function publish() {
    if (stopped) return;
    const items: Item[] = [];
    for (const [serverId, host] of hosts) {
      if (!host.online) continue;
      for (const { agent, project } of host.entries.values()) {
        const key = `${serverId}:${agent.id}`;
        const found = seen.get(key)?.found;
        if (!found || isDismissed(dismissals, key, found.print)) continue;
        items.push({
          ...found,
          key,
          serverId,
          agentId: agent.id,
          workspaceId: agent.workspaceId ?? null,
          projectId: project?.projectKey ?? null,
          title: displayTitle(agent.title),
          project: project?.projectName ?? null,
          hostLabel: host.label,
          at: agent.updatedAt,
        });
      }
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    ready ||= listed && reading.size === 0;
    const next: Snapshot = { status: ready ? "ready" : "loading", items, provider, problem };
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function pump() {
    while (running < READS_AT_ONCE && queue.length) {
      const job = queue.shift()!;
      running++;
      void job().finally(() => {
        running--;
        pump();
      });
    }
  }

  /** Ask the host's model, or fall back to the rules. `settled` says whether to keep the answer. */
  async function judge(text: string): Promise<{ verdict: Verdict; settled: boolean }> {
    const rules = ruleVerdict(text);
    try {
      const result = await rpc(judgeRpc, { text });
      if (result.status === "judged") {
        provider = result.provider;
        problem = null;
        return { verdict: result.verdict, settled: true };
      }
      if (result.status === "off") {
        provider = null;
        problem = null;
        return { verdict: rules, settled: true };
      }
      problem = result.error;
    } catch (error) {
      problem = error instanceof Error ? error.message : "The host could not be reached.";
    }
    return { verdict: rules, settled: false };
  }

  async function read(serverId: string, entry: HostEntry, stamp: string) {
    const key = `${serverId}:${entry.agent.id}`;
    try {
      const page = await lookup(serverId)
        .agents.ref(entry.agent.id)
        .timeline.refetch({ direction: "tail", limit: TAIL_ITEMS, projection: "projected" });
      const message = lastAgentMessage(page.entries);
      let found: Found = null;
      let retryAt: number | null = null;
      if (message) {
        const print = fingerprint(message);
        const memo = `${key}:${print}`;
        let verdict = judged.get(memo);
        if (verdict === undefined) {
          const answer = await judge(message);
          verdict = answer.verdict;
          if (answer.settled) judged.set(memo, verdict);
          else retryAt = now() + RETRY_MS;
        }
        if (verdict !== "none") found = { kind: verdict, excerpt: excerpt(message), print };
      }
      // The agent moved on while this was being read: what it said no longer applies.
      if (currentStamp(serverId, entry.agent.id) === stamp)
        seen.set(key, { stamp, found, retryAt });
    } catch {
      // Unreachable for now. It stays as it was, and the next refresh tries again.
    } finally {
      if (reading.get(key) === stamp) reading.delete(key);
      publish();
    }
  }

  const stateOf = ({ agent }: HostEntry) => `${agent.updatedAt}|${agent.status}`;

  function currentStamp(serverId: string, agentId: string) {
    const entry = hosts.get(serverId)?.entries.get(agentId);
    return entry ? stateOf(entry) : null;
  }

  function consider(serverId: string, entry: HostEntry) {
    const key = `${serverId}:${entry.agent.id}`;
    const stamp = stateOf(entry);
    const assessment = assess(entry.agent);
    if (assessment.kind !== "read") {
      const found = assessment.kind === "flag" ? assessment.flag : null;
      seen.set(key, { stamp, found, retryAt: null });
      return;
    }
    const last = seen.get(key);
    if (last?.stamp === stamp && (last.retryAt === null || last.retryAt > now())) return;
    if (reading.get(key) === stamp) return;
    reading.set(key, stamp);
    queue.push(() => read(serverId, entry, stamp));
    pump();
  }

  function forget(serverId: string, agentId: string) {
    const key = `${serverId}:${agentId}`;
    hosts.get(serverId)?.entries.delete(agentId);
    seen.delete(key);
    for (const memo of judged.keys()) if (memo.startsWith(`${key}:`)) judged.delete(memo);
  }

  async function refreshHost(serverId: string) {
    const host = hosts.get(serverId);
    if (!host?.online) return;
    let entries: readonly HostEntry[];
    try {
      ({ entries } = await lookup(serverId).agents.list(LIST));
    } catch {
      return;
    }
    if (stopped || !host.online) return;
    const present = new Set(entries.map(({ agent }) => agent.id));
    for (const id of host.entries.keys()) if (!present.has(id)) forget(serverId, id);
    for (const entry of entries) {
      host.entries.set(entry.agent.id, entry);
      consider(serverId, entry);
    }
  }

  function connect(serverId: string, host: Host) {
    try {
      host.stop = lookup(serverId).agents.subscribe((update: HostAgentUpdate) => {
        if (update.kind === "remove") forget(serverId, update.agentId);
        else {
          const entry = { agent: update.agent, project: update.project };
          host.entries.set(update.agent.id, entry);
          consider(serverId, entry);
        }
        publish();
      });
    } catch {
      host.stop = null;
    }
  }

  async function fetchDismissals() {
    const result = await rpc(contract.read, {});
    if (result.status !== "ready") throw new Error(result.error);
    return { revision: result.revision, doc: DismissalsSchema.parse(result.values) };
  }

  /** Catch up with other devices, unless a dismissal made here is still on its way. */
  async function loadDismissals() {
    try {
      const latest = await fetchDismissals();
      if (writing > 0) return;
      revision = latest.revision;
      dismissals = latest.doc;
    } catch {
      // The host's dismissals stay as last read until it can be reached.
    }
  }

  /** Resolves to whether the model in use changed, which also judges everything again. */
  async function loadStatus() {
    try {
      const status = await rpc(statusRpc, {});
      const active = status.keySource ? status.provider : null;
      if (active === provider) return false;
      // Someone changed the model, so what the old one decided no longer stands.
      provider = active;
      problem = null;
      rejudge();
      return true;
    } catch {
      return false;
    }
  }

  function rejudge() {
    judged.clear();
    for (const [key, last] of seen) seen.set(key, { ...last, stamp: "" });
    for (const [serverId, host] of hosts)
      if (host.online) for (const entry of host.entries.values()) consider(serverId, entry);
  }

  async function refresh() {
    if (stopped) return;
    await Promise.all([
      loadDismissals(),
      loadStatus(),
      ...[...hosts.keys()].map((serverId) => refreshHost(serverId)),
    ]);
    listed ||= hostsKnown;
    publish();
  }

  async function persistDismissal(key: string, print: string, at: number) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (revision === null) ({ revision } = await fetchDismissals());
      const result = await rpc(contract.write, {
        revision: revision ?? "",
        values: addDismissal(dismissals, key, print, at),
      });
      if (result.status === "saved") {
        revision = result.revision;
        return;
      }
      if (result.status !== "conflict") throw new Error(result.error);
      // Another device wrote first: keep its dismissals along with the ones made here.
      const latest = await fetchDismissals();
      revision = latest.revision;
      dismissals = mergeDismissals(latest.doc, dismissals);
    }
    throw new Error("Dismissal could not be saved.");
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The configured hosts. Agents are listed from the ones online. */
    setHosts(summaries: readonly HostSummary[]) {
      hostsKnown = true;
      const configured = new Set(summaries.map(({ serverId }) => serverId));
      for (const [serverId, host] of hosts)
        if (!configured.has(serverId)) {
          host.stop?.();
          hosts.delete(serverId);
        }
      const fresh: string[] = [];
      for (const { serverId, label, status } of summaries) {
        const online = status === "online";
        let host = hosts.get(serverId);
        if (!host) {
          host = { label, online: false, entries: new Map(), stop: null };
          hosts.set(serverId, host);
        }
        host.label = label;
        if (online && !host.online) {
          host.online = true;
          connect(serverId, host);
          fresh.push(serverId);
        } else if (!online && host.online) {
          host.online = false;
          host.stop?.();
          host.stop = null;
        }
      }
      publish();
      return Promise.all(fresh.map((serverId) => refreshHost(serverId))).then(() => {
        listed = true;
        publish();
      });
    },
    refresh,
    /** The sidebar's key for an item's project, or null when its host cannot say. */
    async sidebarKeyFor({ serverId, projectId }: Pick<Item, "serverId" | "projectId">) {
      if (!projectId) return null;
      try {
        const { projects } = await lookup(serverId).projects.list();
        return sidebarKey(projects, serverId, projectId);
      } catch {
        return null;
      }
    },
    /** The model settings changed here, so judge everything again now. */
    async detectionChanged() {
      if (!(await loadStatus())) rejudge();
      publish();
    },
    dismiss(item: Pick<Item, "key" | "print">) {
      const at = now();
      dismissals = addDismissal(dismissals, item.key, item.print, at);
      publish();
      writing++;
      writes = writes
        .then(() => persistDismissal(item.key, item.print, at))
        .then(() => {
          problem = null;
        })
        .catch(() => {
          problem = "That dismissal could not be saved, so it may come back.";
        })
        .finally(() => {
          writing--;
          publish();
        });
      return writes;
    },
    /** Load now and refresh every `intervalMs`, as a backstop to the live updates. */
    start(intervalMs = 20_000) {
      void refresh();
      const timer = setInterval(() => void refresh(), intervalMs);
      return () => {
        clearInterval(timer);
        stopped = true;
        for (const host of hosts.values()) host.stop?.();
        listeners.clear();
      };
    },
  };
}
