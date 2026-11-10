import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  HostAgent,
  HostAgentUpdate,
  HostApi,
  HostEntry,
  HostLookup,
  TimelineItem,
} from "../client/hosts";
import { createStore, type StoreOptions } from "../client/store";

const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
};

let clock = 0;
function agent(id: string, patch: Partial<HostAgent> = {}): HostEntry {
  return {
    agent: {
      id,
      status: "idle",
      title: `Agent ${id}`,
      updatedAt: new Date(1_800_000_000_000 + ++clock * 1000).toISOString(),
      labels: {},
      pendingPermissions: [],
      ...patch,
    },
    project: { projectName: "Project" },
  };
}

const say = (type: string, text: string): TimelineItem => ({ type, text });
const asked = (text: string) => [say("user_message", "go"), say("assistant_message", text)];

function fakeHost(entries: HostEntry[], timelines: Record<string, TimelineItem[]>) {
  const state = {
    entries,
    timelines,
    reads: 0,
    offline: false,
    handlers: new Set<(update: HostAgentUpdate) => void>(),
    push(update: HostAgentUpdate) {
      for (const handler of state.handlers) handler(update);
    },
  };
  const api: HostApi = {
    agents: {
      list: async () => {
        if (state.offline) throw new Error("offline");
        return { entries: state.entries };
      },
      subscribe: (handler) => {
        state.handlers.add(handler);
        return () => state.handlers.delete(handler);
      },
      ref: (id) => ({
        timeline: {
          refetch: async () => {
            state.reads++;
            if (state.offline) throw new Error("offline");
            return { entries: (state.timelines[id] ?? []).map((item) => ({ item })) };
          },
        },
      }),
    },
  };
  return { state, api };
}

type Judge = { status: "off" } | { status: "failed"; error: string } | Record<string, unknown>;

/** The host end: dismissals with revision checks, and the model's answers. */
function fakeRpc(options: { judge?: () => Judge; provider?: string | null } = {}) {
  const host = {
    values: { dismissed: {} } as unknown,
    revision: 1,
    judged: 0,
    writes: 0,
    provider: options.provider ?? null,
    judge: options.judge ?? (() => ({ status: "off" })),
  };
  const rpc = (async (contract: { name: string }, input: { revision: string; values: unknown }) => {
    if (contract.name === "detection.judge") {
      host.judged++;
      return host.judge();
    }
    if (contract.name === "detection.status")
      return { provider: host.provider, keySource: host.provider ? "saved" : null };
    if (contract.name === "settings.dismissals.read")
      return { status: "ready", revision: String(host.revision), values: host.values };
    if (contract.name === "settings.dismissals.write") {
      if (input.revision !== String(host.revision))
        return { status: "conflict", error: "Revision changed" };
      host.writes++;
      host.values = input.values;
      host.revision++;
      return { status: "saved", revision: String(host.revision), values: host.values };
    }
    throw new Error(`Unexpected rpc ${contract.name}`);
  }) as unknown as StoreOptions["rpc"];
  return { host, rpc };
}

const ONLINE = [{ serverId: "s1", label: "Mac", status: "online" }];

async function started(
  fake: ReturnType<typeof fakeHost>,
  rpcOptions: Parameters<typeof fakeRpc>[0] = {},
) {
  const { host, rpc } = fakeRpc(rpcOptions);
  const lookup: HostLookup = () => fake.api;
  const store = createStore({ rpc, lookup, now: () => 1_000 });
  await store.setHosts(ONLINE);
  await store.refresh();
  await settle();
  return { store, host, rpc };
}

const items = (store: { getSnapshot(): { items: readonly { agentId: string }[] } }) =>
  store.getSnapshot().items.map((item) => item.agentId);

test("an agent whose last message asks something is listed, one that reports is not", async () => {
  const fake = fakeHost([agent("a"), agent("b")], {
    a: asked("Should I ship it?"),
    b: asked("Shipped. Nothing is left to do."),
  });
  const { store } = await started(fake);
  assert.deepEqual(items(store), ["a"]);
  const [item] = store.getSnapshot().items;
  assert.equal(item.kind, "question");
  assert.equal(item.title, "Agent a");
  assert.equal(item.project, "Project");
  assert.equal(item.hostLabel, "Mac");
  assert.equal(item.excerpt, "Should I ship it?");
  assert.equal(store.getSnapshot().status, "ready");
});

test("newest first", async () => {
  const fake = fakeHost([agent("old"), agent("new")], {
    old: asked("Old?"),
    new: asked("New?"),
  });
  const { store } = await started(fake);
  assert.deepEqual(items(store), ["new", "old"]);
});

test("replying clears it straight away, and a new question brings it back", async () => {
  const entry = agent("a");
  const fake = fakeHost([entry], { a: asked("Ship it?") });
  const { store } = await started(fake);
  assert.deepEqual(items(store), ["a"]);

  const running = agent("a", { status: "running" });
  fake.state.entries = [running];
  fake.state.push({ kind: "upsert", ...running });
  assert.deepEqual(items(store), []);

  const idle = agent("a");
  fake.state.entries = [idle];
  fake.state.timelines.a = asked("And the docs too?");
  fake.state.push({ kind: "upsert", ...idle });
  await settle();
  assert.equal(store.getSnapshot().items[0].excerpt, "And the docs too?");
});

test("a person speaking last is not listed even if the agent's status lags", async () => {
  const fake = fakeHost([agent("a")], {
    a: [say("assistant_message", "Ship it?"), say("user_message", "Yes")],
  });
  const { store } = await started(fake);
  assert.deepEqual(items(store), []);
});

test("agents started by another agent are left out", async () => {
  const fake = fakeHost([agent("a", { labels: { "paseo.parent-agent-id": "p" } })], {
    a: asked("Ship it?"),
  });
  const { store } = await started(fake);
  assert.deepEqual(items(store), []);
  assert.equal(fake.state.reads, 0);
});

test("permission prompts and failures are listed without reading the timeline", async () => {
  const fake = fakeHost(
    [
      agent("p", {
        status: "running",
        pendingPermissions: [{ id: "r", kind: "tool", name: "Bash", title: "Run it" }],
      }),
      agent("f", { status: "error", lastError: "Boom" }),
    ],
    {},
  );
  const { store } = await started(fake);
  assert.deepEqual(items(store).sort(), ["f", "p"]);
  assert.equal(fake.state.reads, 0);
});

test("an unchanged agent is read once however often the list refreshes", async () => {
  const fake = fakeHost([agent("a")], { a: asked("Ship it?") });
  const { store } = await started(fake);
  await store.refresh();
  await store.refresh();
  await settle();
  assert.equal(fake.state.reads, 1);
});

test("a changed agent with the same message is not judged twice", async () => {
  const fake = fakeHost([agent("a")], { a: asked("Ship it?") });
  const { store, host } = await started(fake);
  const renamed = agent("a", { title: "Renamed" });
  fake.state.entries = [renamed];
  fake.state.push({ kind: "upsert", ...renamed });
  await settle();
  assert.equal(host.judged, 1);
  assert.equal(store.getSnapshot().items[0].title, "Renamed");
});

test("the model's verdict beats the rules", async () => {
  const fake = fakeHost([agent("a"), agent("b")], {
    a: asked("Why did it fail? A null check. Fixed."),
    b: asked("The build is ready for you to try."),
  });
  let call = 0;
  const judge = () => ({
    status: "judged",
    verdict: ++call === 1 ? "none" : "action",
    provider: "openrouter",
  });
  const { store } = await started(fake, { judge, provider: "openrouter" });
  assert.deepEqual(items(store), ["b"]);
  assert.equal(store.getSnapshot().items[0].kind, "action");
  assert.equal(store.getSnapshot().provider, "openrouter");
  assert.equal(store.getSnapshot().problem, null);
});

test("when the model fails the rules take over and the problem is shown", async () => {
  const fake = fakeHost([agent("a")], { a: asked("Ship it?") });
  const judge = () => ({ status: "failed", error: "OpenRouter rejected the key." });
  const { store } = await started(fake, { judge, provider: "openrouter" });
  assert.deepEqual(items(store), ["a"]);
  assert.equal(store.getSnapshot().problem, "OpenRouter rejected the key.");
});

test("a failed judgment is retried later, and not before", async () => {
  const fake = fakeHost([agent("a")], { a: asked("Ship it?") });
  const { host, rpc } = fakeRpc({ judge: () => ({ status: "failed", error: "Down" }) });
  let time = 1_000;
  const store = createStore({ rpc, lookup: () => fake.api, now: () => time });
  await store.setHosts(ONLINE);
  await settle();
  assert.equal(host.judged, 1);
  await store.refresh();
  await settle();
  assert.equal(host.judged, 1);
  time += 6 * 60_000;
  host.judge = () => ({ status: "judged", verdict: "none", provider: "openrouter" });
  await store.refresh();
  await settle();
  assert.equal(host.judged, 2);
  assert.deepEqual(items(store), []);
  assert.equal(store.getSnapshot().problem, null);
});

test("adding a key judges everything again with the model", async () => {
  const fake = fakeHost([agent("a")], { a: asked("Ship it?") });
  const { store, host } = await started(fake);
  assert.deepEqual(items(store), ["a"]);
  assert.equal(store.getSnapshot().provider, null);

  host.provider = "vercel";
  host.judge = () => ({ status: "judged", verdict: "none", provider: "vercel" });
  await store.detectionChanged();
  await settle();
  assert.deepEqual(items(store), []);
  assert.equal(store.getSnapshot().provider, "vercel");
});

test("dismissing hides it, is saved on the host, and survives a reload", async () => {
  const fake = fakeHost([agent("a")], { a: asked("Ship it?") });
  const { store, host, rpc } = await started(fake);
  await store.dismiss(store.getSnapshot().items[0]);
  assert.deepEqual(items(store), []);
  assert.equal(host.writes, 1);

  const again = createStore({ rpc, lookup: () => fake.api, now: () => 1_000 });
  await again.setHosts(ONLINE);
  await again.refresh();
  await settle();
  assert.deepEqual(items(again), []);
});

test("a dismissed agent comes back when it says something new", async () => {
  const fake = fakeHost([agent("a")], { a: asked("Ship it?") });
  const { store } = await started(fake);
  await store.dismiss(store.getSnapshot().items[0]);

  const idle = agent("a");
  fake.state.entries = [idle];
  fake.state.timelines.a = asked("A different question?");
  fake.state.push({ kind: "upsert", ...idle });
  await settle();
  assert.deepEqual(items(store), ["a"]);
});

test("a dismissal made on another device while this one saves is kept", async () => {
  const fake = fakeHost([agent("a")], { a: asked("Ship it?") });
  const { store, host } = await started(fake);
  host.values = { dismissed: { "s1:other": { print: "x", at: 5 } } };
  host.revision++;
  await store.dismiss(store.getSnapshot().items[0]);
  const saved = host.values as { dismissed: Record<string, unknown> };
  assert.ok(saved.dismissed["s1:other"], "the other device's dismissal survives");
  assert.ok(saved.dismissed["s1:a"], "this dismissal is saved");
});

test("a host going offline hides its agents; coming back shows them again", async () => {
  const fake = fakeHost([agent("a")], { a: asked("Ship it?") });
  const { store } = await started(fake);
  await store.setHosts([{ ...ONLINE[0], status: "offline" }]);
  assert.deepEqual(items(store), []);
  assert.equal(fake.state.handlers.size, 0, "stops listening");
  await store.setHosts(ONLINE);
  await settle();
  assert.deepEqual(items(store), ["a"]);
});

test("an unreachable host keeps what it had and raises nothing", async () => {
  const fake = fakeHost([agent("a")], { a: asked("Ship it?") });
  const { store } = await started(fake);
  fake.state.offline = true;
  await store.refresh();
  await settle();
  assert.deepEqual(items(store), ["a"]);
  assert.equal(store.getSnapshot().problem, null);
});

test("hosts are combined, and an archived or deleted agent leaves the list", async () => {
  const one = fakeHost([agent("a")], { a: asked("One?") });
  const two = fakeHost([agent("b")], { b: asked("Two?") });
  const { rpc } = fakeRpc();
  const store = createStore({
    rpc,
    lookup: (serverId) => (serverId === "s1" ? one.api : two.api),
    now: () => 1_000,
  });
  await store.setHosts([ONLINE[0], { serverId: "s2", label: "Mini", status: "online" }]);
  await settle();
  assert.deepEqual(items(store).sort(), ["a", "b"]);

  two.state.entries = [];
  two.state.push({ kind: "remove", agentId: "b" });
  assert.deepEqual(items(store), ["a"]);

  one.state.entries = [];
  await store.refresh();
  assert.deepEqual(items(store), []);
});

test("it stays loading until the first look at every agent is done", async () => {
  const fake = fakeHost([agent("a")], { a: asked("Ship it?") });
  const { rpc } = fakeRpc();
  const store = createStore({ rpc, lookup: () => fake.api, now: () => 1_000 });
  assert.equal(store.getSnapshot().status, "loading");
  await store.refresh();
  assert.equal(store.getSnapshot().status, "loading", "no hosts reported yet");
  await store.setHosts(ONLINE);
  await settle();
  assert.equal(store.getSnapshot().status, "ready");
});
