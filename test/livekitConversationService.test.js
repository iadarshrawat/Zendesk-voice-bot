import assert from "node:assert/strict";
import test from "node:test";

import { loadVoiceConfig } from "../src/config/voice.js";
import { LiveKitConversationService } from "../src/services/livekitConversationService.js";

const brand = { key: "mr-brand", displayName: "Mr Brand" };

function testConfig(overrides = {}) {
  return {
    ...loadVoiceConfig({
      VOICE_THINKING_MESSAGE: "Checking now.",
      VOICE_THINKING_DELAY_MS: "10000",
    }),
    ...overrides,
  };
}

test("sends the final LiveKit transcript through the existing RAG function", async () => {
  const calls = [];
  const spoken = [];
  const service = new LiveKitConversationService({
    brand,
    appConfig: testConfig(),
    tracePrefix: "room:test",
    speak: (text, options) => spoken.push({ text, options }),
    generateVoiceReply: async (input) => {
      calls.push(input);
      return { status: "answer", reply: "**Use the school-rated floor fan.**" };
    },
  });

  const reply = await service.handleUserTurn("Suggest a fan for a school");

  assert.equal(reply, "Use the school-rated floor fan.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].brand, "Mr Brand");
  assert.equal(calls[0].question, "Suggest a fan for a school");
  assert.equal(calls[0].history, "");
  assert.equal(spoken.at(-1).text, "Use the school-rated floor fan.");
});

test("keeps prior voice turns as RAG conversation history", async () => {
  const calls = [];
  const service = new LiveKitConversationService({
    brand,
    appConfig: testConfig(),
    tracePrefix: "room:history",
    speak: () => {},
    generateVoiceReply: async (input) => {
      calls.push(input);
      return { status: "answer", reply: calls.length === 1 ? "Which type do you need?" : "Try this model." };
    },
  });

  await service.handleUserTurn("I need a fan.");
  await service.handleUserTurn("A floor fan.");

  assert.match(calls[1].history, /Customer: I need a fan\./);
  assert.match(calls[1].history, /Assistant: Which type do you need\?/);
  assert.equal(calls[1].question, "A floor fan.");
});

test("uses the configured error message if RAG generation fails", async () => {
  const spoken = [];
  const service = new LiveKitConversationService({
    brand,
    appConfig: testConfig({ errorMessage: "Please try again." }),
    tracePrefix: "room:error",
    speak: (text) => spoken.push(text),
    generateVoiceReply: async () => {
      throw new Error("database unavailable");
    },
  });

  const reply = await service.handleUserTurn("Which fan should I buy?");

  assert.equal(reply, "Please try again.");
  assert.equal(spoken.at(-1), "Please try again.");
});
