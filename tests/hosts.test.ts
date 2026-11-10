import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, assess, displayTitle, type HostAgent, lastAgentMessage } from "../client/hosts";

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

test("the last message is the agent's final one", () => {
  const entries = [
    say("user_message", "first"),
    say("assistant_message", "older"),
    say("user_message", "second"),
    say("assistant_message", "working on it"),
    say("tool_call"),
    say("assistant_message", "Should I ship it?"),
    say("tool_call"),
  ];
  assert.equal(lastAgentMessage(entries), "Should I ship it?");
});

test("nothing is open once the person has spoken last", () => {
  assert.equal(
    lastAgentMessage([say("assistant_message", "Ship it?"), say("user_message", "Yes")]),
    null,
  );
});

test("a tail with no agent text has nothing to read", () => {
  assert.equal(lastAgentMessage([say("tool_call"), say("assistant_message", "  ")]), null);
});

test("a tail that has lost the person's message still has the agent's", () => {
  assert.equal(lastAgentMessage([say("assistant_message", "Ok?")]), "Ok?");
});

test("ago", () => {
  const now = Date.parse("2026-11-10T10:00:00.000Z");
  assert.equal(ago("2026-11-10T09:59:30.000Z", now), "now");
  assert.equal(ago("2026-11-10T09:45:00.000Z", now), "15m");
  assert.equal(ago("2026-11-10T07:00:00.000Z", now), "3h");
  assert.equal(ago("2026-11-08T10:00:00.000Z", now), "2d");
});

test("a title Paseo cut mid-word ends at its last whole word, with an ellipsis", () => {
  const cut = "For the shop we want to make quite a big change. What we wa";
  assert.equal(cut.length, 59);
  const midWord = `${cut}n`;
  assert.equal(displayTitle(midWord), "For the shop we want to make quite a big change. What we…");
  assert.equal(
    displayTitle(`${"a".repeat(30)}, and ${"b".repeat(20)} c.d e`.slice(0, 60)).at(-1),
    "…",
  );
});

test("a cut that landed on a space keeps its last word", () => {
  const title = `${"word ".repeat(11)}abcdefghij`.slice(0, 59).trim();
  assert.equal(title.length, 59);
  assert.equal(displayTitle(title), `${title}…`);
});

test("a cut with no spaces keeps what it has", () => {
  assert.equal(displayTitle("x".repeat(60)), `${"x".repeat(60)}…`);
});

test("a title that ends on punctuation does not get punctuation before the ellipsis", () => {
  const title = `${"a".repeat(45)} big change. W`.padEnd(60, "W");
  assert.equal(displayTitle(title), `${"a".repeat(45)} big change…`);
});

test("ordinary titles are left alone, and a missing one has a name", () => {
  assert.equal(displayTitle("Fix the login page"), "Fix the login page");
  assert.equal(displayTitle("  "), "Untitled agent");
  assert.equal(displayTitle(null), "Untitled agent");
});

test("an approval shows the command or file it is for, not just the tool's name", () => {
  const ask = (input: Record<string, unknown>) =>
    assess(
      agent({
        pendingPermissions: [{ id: "r", kind: "tool", name: "Bash", title: "Bash", input }],
      }),
    );
  const excerpt = (result: ReturnType<typeof ask>) => result.kind === "flag" && result.flag.excerpt;
  assert.equal(excerpt(ask({ command: "npm test" })), "Waiting for your approval: npm test");
  assert.equal(excerpt(ask({ file_path: "/a/b.ts" })), "Waiting for your approval: /a/b.ts");
  assert.equal(excerpt(ask({})), "Waiting for your approval: Bash");
});
