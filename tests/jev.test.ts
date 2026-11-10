import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRequest, decide, QUESTIONS, readAnswers, THRESHOLD } from "../shared/jev";

const low = THRESHOLD - 0.01;

test("truth table: the strongest ask wins, in order", () => {
  assert.equal(decide({ asks: 0.9, acts: 0.9, offers: 0.9 }), "question");
  assert.equal(decide({ asks: low, acts: 0.9, offers: 0.9 }), "action");
  assert.equal(decide({ asks: low, acts: low, offers: 0.9 }), "offer");
  assert.equal(decide({ asks: low, acts: low, offers: low }), "none");
});

test("truth table: an unsettled answer is listed rather than missed", () => {
  assert.equal(decide({ asks: 0.5, acts: 0, offers: 0 }), "question");
  assert.equal(decide({ asks: THRESHOLD, acts: 0, offers: 0 }), "question");
});

test("the request keeps the end of a long message and every question", () => {
  const body = buildRequest("m", { text: `${"a".repeat(30_000)}END`, request: null });
  assert.equal(body.model, "m");
  assert.equal(body.state.agent_message.length, 20_000);
  assert.ok(body.state.agent_message.endsWith("END"));
  assert.deepEqual(Object.keys(body.questions), Object.keys(QUESTIONS));
});

test("an unknown request is left out of the state, not sent empty", () => {
  assert.ok(!("person_request" in buildRequest("m", { text: "x", request: null }).state));
  const state = buildRequest("m", { text: "x", request: "do it" }).state as Record<string, string>;
  assert.equal(state.person_request, "do it");
});

test("answers are read by name", () => {
  const answers = {
    asks_question: { type: "noul", noul: 0.8 },
    asks_action: { type: "noul", noul: 0.1 },
    offers_more: { type: "noul", noul: 0.2 },
  };
  assert.deepEqual(readAnswers({ answers }), { asks: 0.8, acts: 0.1, offers: 0.2 });
});

test("a malformed response is an error, never a no", () => {
  assert.throws(() => readAnswers({}));
  assert.throws(() => readAnswers(null));
  assert.throws(() => readAnswers({ answers: { asks_question: { noul: 0.1 } } }));
});

test("truth table: a faint offer is not worth listing, a clear one is", () => {
  assert.equal(decide({ asks: 0, acts: 0, offers: 0.4 }), "none");
  assert.equal(decide({ asks: 0, acts: 0, offers: 0.5 }), "offer");
});
