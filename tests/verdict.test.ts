import assert from "node:assert/strict";
import { test } from "node:test";
import { excerpt, fingerprint, readable, ruleVerdict } from "../shared/verdict";

const cases: [string, string, ReturnType<typeof ruleVerdict>][] = [
  ["a direct question", "Want me to write it up as a proposal doc?", "question"],
  [
    "questions mid-message, statement last",
    "1. Can I do this? I recommend yes.\n\nAnd I'll report back.",
    "question",
  ],
  ["a Dutch question", "Kun je dat bevestigen en de order weer op Refunded zetten?", "question"],
  [
    "waiting on something only the person can do",
    "Once you've run it, I'll check the policy counts.",
    "action",
  ],
  [
    "a token still needed",
    "When you're ready to deploy, I'll need that Cloudflare token.",
    "action",
  ],
  ["tell me", "It costs $31 a month, so tell me if you'd rather have it shut down.", "action"],
  ["Dutch request", "Laat me weten welke optie je kiest.", "action"],
  ["Dutch: send me", "Stuur me dan de ordernotities van deze bestelling.", "action"],
  [
    "a soft offer",
    "If you want to know it works before Monday, I can trigger one run now.",
    "offer",
  ],
  ["Dutch offer", "Als je wilt, draai ik het nog een keer.", "offer"],
  ["a plain report", "PR #268 is open and CI is running. Nothing is merged.", "none"],
  ["says nothing is needed", "The design guide builder is working. Nothing needs you yet.", "none"],
  [
    "says nobody is blocked",
    "I'll merge each one when its builder reports done. No builder is waiting on approval.",
    "none",
  ],
  [
    "question mark in a link title",
    "Sources:\n- [Does AI favor translated content?](https://example.com/a)",
    "none",
  ],
  ["question mark in a url", "Deployed to https://example.com/a?b=1 and it works.", "none"],
  ["question mark in inline code", "I changed `a?.b` everywhere and the tests pass.", "none"],
  ["question mark in a code block", "Done.\n```ts\nconst x = a ? b : c;\n```", "none"],
  ["question mark in a heading", "## Why did it fail?\nA null check was missing. Fixed.", "none"],
  ["a quoted question", "> Can you fix this?\n\nFixed it.", "none"],
];

for (const [name, text, expected] of cases)
  test(`rules: ${name}`, () => assert.equal(ruleVerdict(text), expected));

test("readable keeps prose", () => {
  assert.equal(readable("Run `x` then read [this](https://a.b)."), "Run   then read  .");
});

test("excerpt shows a numbered list of questions from its first item", () => {
  const text = [
    "Some long report about what happened.",
    "",
    "**To start, I need your answer on two things:**",
    "1. **The look:** can I write a guide? I recommend yes.",
    "2. **Customers:** do they stay put? I recommend yes.",
    "",
    "And when you're ready to deploy, I'll need that token.",
  ].join("\n");
  const shown = excerpt(text);
  assert.ok(shown.startsWith("1. The look: can I write a guide?"), shown);
  assert.ok(shown.includes("2. Customers"), shown);
  assert.ok(!shown.includes("**"), shown);
});

test("excerpt falls back to the last line and never shows a code block", () => {
  assert.equal(excerpt("First line.\n```\nsecret()\n```\nLast line."), "Last line.");
});

test("excerpt is cut to length", () => {
  const shown = excerpt(`${"word ".repeat(200)}?`, 50);
  assert.ok(shown.length <= 50 && shown.endsWith("…"), shown);
});

test("fingerprints differ for different text and match for the same", () => {
  assert.equal(fingerprint("same"), fingerprint("same"));
  assert.notEqual(fingerprint("a message"), fingerprint("a messagf"));
});
