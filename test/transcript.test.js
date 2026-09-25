import assert from "node:assert/strict";
import test from "node:test";

import { buildRagTurn, normalizeTranscript } from "../src/transcript.js";

test("builds the RAG question from the newest caller utterance", () => {
  const result = buildRagTurn([
    { role: "agent", content: "How can I help?" },
    { role: "user", content: "I need a school fan." },
    { role: "agent", content: "Do you need a floor fan?" },
    { role: "user", content: "Yes, a floor fan." },
  ]);

  assert.equal(result.question, "Yes, a floor fan.");
  assert.equal(result.history,
    "Assistant: How can I help?\nCustomer: I need a school fan.\nAssistant: Do you need a floor fan?");
});

test("drops invalid transcript rows and bounds history size", () => {
  assert.deepEqual(normalizeTranscript([
    null,
    { role: "other", content: "ignore" },
    { role: "user", content: "  valid  " },
  ]), [{ role: "user", content: "valid" }]);

  const result = buildRagTurn([
    { role: "agent", content: "A".repeat(800) },
    { role: "user", content: "B".repeat(800) },
    { role: "agent", content: "Recent question context" },
    { role: "user", content: "Latest question" },
  ], 1_000);

  assert.equal(result.question, "Latest question");
  assert.ok(result.history.length <= 1_000);
  assert.match(result.history, /Recent question context/);
});
