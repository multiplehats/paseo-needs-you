import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, assess, type HostAgent, lastExchange } from "../client/hosts";

export const agent = (patch: Partial<HostAgent> = {}): HostAgent => ({
  id: "a1",
  status: "idle",
  title: "Agent",
  updatedAt: "2026-11-10T10:00:00.000Z",
  labels: {},
  pendingPermissions: [],
  ...patch,
});
const child = { "paseo.parent-agent-id": "p1" };
const say = (type: string, text?: string) => ({ item: { type, text } });

test("an idle top-level agent is read", () => {
  assert.deepEqual(assess(agent()), { kind: "read" });
});

test("running, closed and archived agents are skipped", () => {
  assert.equal(assess(agent({ status: "running" })).kind, "skip");
  assert.equal(assess(agent({ status: "initializing" })).kind, "skip");
  assert.equal(assess(agent({ status: "closed" })).kind, "skip");
  assert.equal(assess(agent({ archivedAt: "2026-11-01T00:00:00.000Z" })).kind, "skip");
});

test("an agent started by another agent is not read", () => {
  assert.equal(assess(agent({ labels: child })).kind, "skip");
  assert.equal(assess(agent({ labels: child, status: "error" })).kind, "skip");
});

test("a permission prompt flags even a running child agent", () => {
  const pendingPermissions = [{ id: "r1", kind: "tool", name: "Bash", title: "Run ls" }];
  const result = assess(agent({ status: "running", labels: child, pendingPermissions }));
  assert.equal(result.kind, "flag");
  if (result.kind !== "flag") return;
  assert.equal(result.flag.kind, "permission");
  assert.equal(result.flag.print, "permission-r1");
  assert.match(result.flag.excerpt, /Run ls/);
});

test("a question prompt shows the question itself", () => {
  const pendingPermissions = [{ id: "r2", kind: "question", name: "Ask", title: "Which one?" }];
  const result = assess(agent({ pendingPermissions }));
  assert.equal(result.kind === "flag" && result.flag.excerpt, "Which one?");
});

test("a failed agent is flagged with its error", () => {
  const result = assess(agent({ status: "error", lastError: "Out of credit" }));
  assert.equal(result.kind === "flag" && result.flag.kind, "failed");
  assert.equal(result.kind === "flag" && result.flag.excerpt, "Out of credit");
});

test("the last exchange is the final agent message and the person's before it", () => {
  const entries = [
    say("user_message", "first"),
    say("assistant_message", "older"),
    say("user_message", "second"),
    say("assistant_message", "working on it"),
    say("tool_call"),
    say("assistant_message", "Should I ship it?"),
    say("tool_call"),
  ];
  assert.deepEqual(lastExchange(entries), { text: "Should I ship it?", request: "second" });
});

test("nothing is open once the person has spoken last", () => {
  assert.equal(
    lastExchange([say("assistant_message", "Ship it?"), say("user_message", "Yes")]),
    null,
  );
});

test("a tail with no agent text has nothing to read", () => {
  assert.equal(lastExchange([say("tool_call"), say("assistant_message", "  ")]), null);
});

test("a tail that has lost the person's message still has the agent's", () => {
  assert.deepEqual(lastExchange([say("assistant_message", "Ok?")]), { text: "Ok?", request: null });
});

test("ago", () => {
  const now = Date.parse("2026-11-10T10:00:00.000Z");
  assert.equal(ago("2026-11-10T09:59:30.000Z", now), "now");
  assert.equal(ago("2026-11-10T09:45:00.000Z", now), "15m");
  assert.equal(ago("2026-11-10T07:00:00.000Z", now), "3h");
  assert.equal(ago("2026-11-08T10:00:00.000Z", now), "2d");
});
