import assert from "node:assert/strict";
import test from "node:test";

import { loadVoiceConfig } from "../src/config/voice.js";

test("uses the balanced multilingual voice defaults", () => {
  const config = loadVoiceConfig({});

  assert.equal(config.sttModel, "deepgram/nova-3");
  assert.equal(config.sttLanguage, "multi");
  assert.equal(config.sttEndpointingMs, 300);
  assert.equal(config.sttMipOptOut, false);
  assert.equal(config.vadActivationThreshold, 0.40);
  assert.equal(config.vadDeactivationThreshold, 0.25);
  assert.equal(config.endpointMinDelayMs, 500);
  assert.equal(config.endpointMaxDelayMs, 3_000);
  assert.equal(config.noiseCancellationEnabled, false);
  assert.equal(config.noiseCancellationModel, "quailVfL");
  assert.ok(config.sttKeyterms.includes("Mr Brand"));
});

test("loads custom sensitivity, endpointing, keyterms, and privacy values", () => {
  const config = loadVoiceConfig({
    LIVEKIT_STT_LANGUAGE: "en-IN",
    LIVEKIT_STT_KEYTERMS: "AirPro X1, school fan, AirPro X1",
    LIVEKIT_STT_MIP_OPT_OUT: "false",
    LIVEKIT_VAD_ACTIVATION_THRESHOLD: "0.33",
    LIVEKIT_VAD_DEACTIVATION_THRESHOLD: "0.18",
    LIVEKIT_ENDPOINT_MIN_DELAY_MS: "700",
    LIVEKIT_ENDPOINT_MAX_DELAY_MS: "3500",
    LIVEKIT_NOISE_CANCELLATION_ENABLED: "off",
    VOICE_LOG_TRANSCRIPTS: "yes",
  });

  assert.equal(config.sttLanguage, "en-IN");
  assert.deepEqual(config.sttKeyterms, ["AirPro X1", "school fan"]);
  assert.equal(config.sttMipOptOut, false);
  assert.equal(config.vadActivationThreshold, 0.33);
  assert.equal(config.vadDeactivationThreshold, 0.18);
  assert.equal(config.endpointMinDelayMs, 700);
  assert.equal(config.endpointMaxDelayMs, 3_500);
  assert.equal(config.noiseCancellationEnabled, false);
  assert.equal(config.logTranscripts, true);
});

test("falls back to safe values when numeric settings are outside their bounds", () => {
  const config = loadVoiceConfig({
    LIVEKIT_STT_ENDPOINTING_MS: "20",
    LIVEKIT_VAD_ACTIVATION_THRESHOLD: "4",
    LIVEKIT_ENDPOINT_MAX_DELAY_MS: "99999",
    LIVEKIT_TTS_SPEAKING_RATE: "not-a-number",
  });

  assert.equal(config.sttEndpointingMs, 300);
  assert.equal(config.vadActivationThreshold, 0.40);
  assert.equal(config.endpointMaxDelayMs, 3_000);
  assert.equal(config.ttsSpeakingRate, 1.0);
});

test("allows static keyterms to be disabled explicitly", () => {
  const config = loadVoiceConfig({ LIVEKIT_STT_KEYTERMS: "" });

  assert.deepEqual(config.sttKeyterms, []);
});
