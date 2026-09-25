function optionalValue(value) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function integerValue(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function numberValue(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function commaSeparatedValues(value, fallback = []) {
  if (value === undefined || value === null) return [...fallback];

  return [...new Set(String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean))];
}

const DEFAULT_STT_KEYTERMS = Object.freeze([
  "Mr Brand",
  "Comfort Zone",
  "ceiling fan",
  "box fan",
  "tower fan",
  "pedestal fan",
  "table fan",
  "exhaust fan",
  "school classroom",
]);

export function loadVoiceConfig(env = process.env) {
  return Object.freeze({
    beginMessage: optionalValue(env.BEGIN_MESSAGE)
      ?? "Hello! Welcome to customer support. How can I help you today?",
    thinkingMessage: optionalValue(env.VOICE_THINKING_MESSAGE)
      ?? "One moment while I check that for you. ",
    thinkingDelayMs: integerValue(env.VOICE_THINKING_DELAY_MS, 500, { min: 0, max: 10_000 }),
    reminderMessage: optionalValue(env.VOICE_REMINDER_MESSAGE)
      ?? "Are you still there? Please let me know how I can help.",
    noQuestionMessage: optionalValue(env.VOICE_NO_QUESTION_MESSAGE)
      ?? "I didn't catch that. Could you please say your question again?",
    errorMessage: optionalValue(env.VOICE_ERROR_MESSAGE)
      ?? "I'm having trouble checking that right now. Please try asking again.",
    timeoutMessage: optionalValue(env.VOICE_TIMEOUT_MESSAGE)
      ?? "That check is taking longer than expected. Please try asking again.",
    defaultBrand: optionalValue(env.VOICE_SUPPORT_BRAND) ?? "Mr Brand",
    maxHistoryChars: integerValue(env.VOICE_HISTORY_MAX_CHARS, 16_000, { min: 1_000, max: 100_000 }),
    responseTargetMs: integerValue(env.VOICE_RESPONSE_TARGET_MS ?? env.BOT_RESPONSE_TARGET_MS, 15_000,
      { min: 3_000, max: 60_000 }),
    responseHardTimeoutMs: integerValue(env.VOICE_RESPONSE_HARD_TIMEOUT_MS ?? env.BOT_RESPONSE_HARD_TIMEOUT_MS, 45_000,
      { min: 5_000, max: 120_000 }),
    responseReserveMs: integerValue(env.VOICE_RESPONSE_RESERVE_MS, 750, { min: 0, max: 5_000 }),

    // Speech-to-text. `multi` is the best default for mixed English/Hindi calls.
    // Use `en-IN` when every caller speaks Indian English only.
    sttModel: optionalValue(env.LIVEKIT_STT_MODEL) ?? "deepgram/nova-3",
    sttLanguage: optionalValue(env.LIVEKIT_STT_LANGUAGE) ?? "multi",
    sttEndpointingMs: integerValue(env.LIVEKIT_STT_ENDPOINTING_MS, 300, { min: 100, max: 2_000 }),
    sttKeyterms: Object.freeze(commaSeparatedValues(
      env.LIVEKIT_STT_KEYTERMS,
      DEFAULT_STT_KEYTERMS,
    )),
    sttFallbackModel: optionalValue(env.LIVEKIT_STT_FALLBACK_MODEL),
    sttMipOptOut: booleanValue(env.LIVEKIT_STT_MIP_OPT_OUT, false),

    // Local Silero VAD. A slightly lower activation threshold than the SDK's
    // 0.50 default helps normal/quiet speech without making the detector overly
    // eager. Raise it toward 0.50 in a consistently noisy room.
    vadMinSpeechMs: integerValue(env.LIVEKIT_VAD_MIN_SPEECH_MS, 80, { min: 32, max: 2_000 }),
    vadMinSilenceMs: integerValue(env.LIVEKIT_VAD_MIN_SILENCE_MS, 300, { min: 100, max: 2_000 }),
    vadPrefixPaddingMs: integerValue(env.LIVEKIT_VAD_PREFIX_PADDING_MS, 600, { min: 0, max: 2_000 }),
    vadActivationThreshold: numberValue(env.LIVEKIT_VAD_ACTIVATION_THRESHOLD, 0.40,
      { min: 0.05, max: 0.95 }),
    vadDeactivationThreshold: numberValue(env.LIVEKIT_VAD_DEACTIVATION_THRESHOLD, 0.25,
      { min: 0.01, max: 0.90 }),

    // Semantic turn detection prevents a short pause from cutting a sentence.
    endpointMinDelayMs: integerValue(env.LIVEKIT_ENDPOINT_MIN_DELAY_MS, 500,
      { min: 100, max: 5_000 }),
    endpointMaxDelayMs: integerValue(env.LIVEKIT_ENDPOINT_MAX_DELAY_MS, 3_000,
      { min: 500, max: 10_000 }),
    interruptionMinDurationMs: integerValue(env.LIVEKIT_INTERRUPTION_MIN_DURATION_MS, 500,
      { min: 100, max: 5_000 }),
    interruptionMinWords: integerValue(env.LIVEKIT_INTERRUPTION_MIN_WORDS, 0,
      { min: 0, max: 10 }),
    transcriptionTimeoutMs: integerValue(env.LIVEKIT_TRANSCRIPTION_TIMEOUT_MS, 2_500,
      { min: 1_000, max: 15_000 }),

    // Text-to-speech. Inworld stays the default so this update does not change
    // the project's current provider or billing profile.
    ttsModel: optionalValue(env.LIVEKIT_TTS_MODEL) ?? "inworld/inworld-tts-2",
    ttsVoice: optionalValue(env.LIVEKIT_TTS_VOICE) ?? "Ashley",
    ttsSpeakingRate: numberValue(env.LIVEKIT_TTS_SPEAKING_RATE, 1.0, { min: 0.6, max: 1.4 }),
    ttsFallbackModel: optionalValue(env.LIVEKIT_TTS_FALLBACK_MODEL),
    ttsFallbackVoice: optionalValue(env.LIVEKIT_TTS_FALLBACK_VOICE),

    // Leave enhanced backend filtering off for a clean, close microphone. Turn
    // it on in noisy or cross-talk environments; browser AEC remains separate.
    noiseCancellationEnabled: booleanValue(env.LIVEKIT_NOISE_CANCELLATION_ENABLED, false),
    noiseCancellationModel: optionalValue(env.LIVEKIT_NOISE_CANCELLATION_MODEL) ?? "quailVfL",

    agentName: optionalValue(env.LIVEKIT_AGENT_NAME) ?? "zendesk-rag-voice-agent",
    logTranscripts: booleanValue(env.VOICE_LOG_TRANSCRIPTS, false),
    logAudioEvents: booleanValue(env.VOICE_LOG_AUDIO_EVENTS, true),
  });
}

export const voiceConfig = loadVoiceConfig();

export function getMissingVoiceRagConfiguration(env = process.env) {
  const required = {
    ANTHROPIC_API_KEY: optionalValue(env.ANTHROPIC_API_KEY),
    COSMOS_ENDPOINT: optionalValue(env.COSMOS_ENDPOINT),
    COSMOS_KEY: optionalValue(env.COSMOS_KEY),
    VOYAGE_API_KEY: optionalValue(env.VOYAGE_API_KEY),
  };

  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

export function getMissingLiveKitConfiguration(env = process.env) {
  return ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]
    .filter((key) => !optionalValue(env[key]));
}
