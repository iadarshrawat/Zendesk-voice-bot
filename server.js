import {
  AgentSessionEventTypes,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  voice,
} from "@livekit/agents";
import { audioEnhancement } from "@livekit/plugins-ai-coustics";
import { fileURLToPath } from "node:url";

import {
  getMissingLiveKitConfiguration,
  getMissingVoiceRagConfiguration,
  voiceConfig,
} from "./src/config/voice.js";
import { requireSupportBrand } from "./src/config/brands.js";
import { verifyKnowledgeStore } from "./src/config/cosmos.js";
import { RAG_CONFIG } from "./src/config/rag.js";
import { getCatalogSummary } from "./src/services/knowledgeStoreService.js";
import { LiveKitRagAgent } from "./src/livekitRagAgent.js";

function createVad() {
  return new inference.VAD({
    model: "silero",
    minSpeechDuration: voiceConfig.vadMinSpeechMs,
    minSilenceDuration: voiceConfig.vadMinSilenceMs,
    prefixPaddingDuration: voiceConfig.vadPrefixPaddingMs,
    activationThreshold: voiceConfig.vadActivationThreshold,
    deactivationThreshold: voiceConfig.vadDeactivationThreshold,
  });
}

function sttModelOptions() {
  if (!voiceConfig.sttModel.startsWith("deepgram/")) return {};

  return {
    interim_results: true,
    punctuate: true,
    smart_format: true,
    numerals: true,
    endpointing: voiceConfig.sttEndpointingMs,
    mip_opt_out: voiceConfig.sttMipOptOut,
  };
}

function ttsModelOptions() {
  if (!voiceConfig.ttsModel.startsWith("inworld/")) return {};

  return {
    speaking_rate: voiceConfig.ttsSpeakingRate,
    delivery_mode: "STABLE",
    apply_text_normalization: "ON",
  };
}

function sttFallback() {
  return voiceConfig.sttFallbackModel || undefined;
}

function ttsFallback() {
  if (!voiceConfig.ttsFallbackModel || !voiceConfig.ttsFallbackVoice) return undefined;

  return [{
    model: voiceConfig.ttsFallbackModel,
    voice: voiceConfig.ttsFallbackVoice,
  }];
}

function inputOptions() {
  if (!voiceConfig.noiseCancellationEnabled) return {};

  return {
    noiseCancellation: audioEnhancement({
      model: voiceConfig.noiseCancellationModel,
    }),
  };
}

function assertConfiguration() {
  const missingLiveKit = getMissingLiveKitConfiguration();
  const missingRag = getMissingVoiceRagConfiguration();
  const missing = [...missingLiveKit, ...missingRag];
  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }

  if (voiceConfig.vadDeactivationThreshold >= voiceConfig.vadActivationThreshold) {
    throw new Error(
      "LIVEKIT_VAD_DEACTIVATION_THRESHOLD must be lower than LIVEKIT_VAD_ACTIVATION_THRESHOLD",
    );
  }

  if (voiceConfig.endpointMinDelayMs > voiceConfig.endpointMaxDelayMs) {
    throw new Error(
      "LIVEKIT_ENDPOINT_MIN_DELAY_MS must be less than or equal to LIVEKIT_ENDPOINT_MAX_DELAY_MS",
    );
  }

  const hasPartialTtsFallback = Boolean(voiceConfig.ttsFallbackModel)
    !== Boolean(voiceConfig.ttsFallbackVoice);
  if (hasPartialTtsFallback) {
    throw new Error(
      "Set both LIVEKIT_TTS_FALLBACK_MODEL and LIVEKIT_TTS_FALLBACK_VOICE, or leave both empty",
    );
  }
}

const agentDefinition = defineAgent({
  prewarm: async (processContext) => {
    assertConfiguration();
    const brand = requireSupportBrand(voiceConfig.defaultBrand);
    await verifyKnowledgeStore();
    processContext.userData.brand = brand;
    // The Python reference preloads Silero once per worker. The Node SDK's VAD
    // supports multiple streams, so sharing this instance avoids per-call setup.
    processContext.userData.vad = createVad();

    console.log("[startup] Cosmos DB vector knowledge store connected", {
      databaseId: RAG_CONFIG.cosmos.databaseId,
      containerId: RAG_CONFIG.cosmos.containerId,
      defaultBrand: brand.key,
    });

    if (RAG_CONFIG.conversation.warmCatalog) {
      try {
        const summary = await getCatalogSummary(brand.key);
        console.log("[startup] Default brand catalog warmed", {
          brand: brand.key,
          totalProducts: summary?.totalProducts ?? 0,
        });
      } catch (error) {
        console.warn("[startup] Catalog warm-up skipped", { error: error.message });
      }
    }
  },

  entry: async (context) => {
    const brand = context.proc.userData.brand || requireSupportBrand(voiceConfig.defaultBrand);
    const roomName = context.room.name || "unknown-room";
    const session = new voice.AgentSession({
      stt: new inference.STT({
        model: voiceConfig.sttModel,
        language: voiceConfig.sttLanguage,
        modelOptions: sttModelOptions(),
        fallback: sttFallback(),
      }),
      vad: context.proc.userData.vad || createVad(),
      tts: new inference.TTS({
        model: voiceConfig.ttsModel,
        voice: voiceConfig.ttsVoice,
        modelOptions: ttsModelOptions(),
        fallback: ttsFallback(),
      }),
      transcriptionTimeout: voiceConfig.transcriptionTimeoutMs,
      keytermsOptions: {
        keyterms: [...voiceConfig.sttKeyterms],
        // The Python reference uses a fixed product vocabulary. Keeping the
        // background LLM detector disabled avoids another model call per turn.
        keytermDetection: { enabled: false },
      },
      turnHandling: {
        // This is the current Node equivalent of the Python multilingual
        // semantic turn detector. It has cloud -> local fallback built in.
        turnDetection: new inference.TurnDetector(),
        endpointing: {
          mode: "fixed",
          minDelay: voiceConfig.endpointMinDelayMs,
          maxDelay: voiceConfig.endpointMaxDelayMs,
        },
        interruption: {
          enabled: true,
          mode: "adaptive",
          minDuration: voiceConfig.interruptionMinDurationMs,
          minWords: voiceConfig.interruptionMinWords,
          falseInterruptionTimeout: 2_000,
          resumeFalseInterruption: true,
        },
        // This agent runs a custom Cosmos/Voyage/Claude pipeline after the turn
        // is final. Preemptive generation cannot safely start that pipeline on
        // an interim transcript, so it remains disabled intentionally.
        preemptiveGeneration: { enabled: false },
      },
    });

    session.on(AgentSessionEventTypes.UserInputTranscribed, (event) => {
      if (!event.isFinal) return;

      const transcript =
        typeof event.transcript === "string" ? event.transcript.trim() : "";

      console.log("[livekit:stt] Final transcript received", {
        room: roomName,
        language: event.language,
        characters: transcript.length,
        ...(voiceConfig.logTranscripts ? { transcript } : {}),
      });

      if (!transcript) {
        console.warn("[livekit:stt] Empty final transcript received", {
          room: roomName,
        });
      }
    });

    session.on(AgentSessionEventTypes.UserTranscriptionTimeout, (event) => {
      console.warn("[livekit:stt] Speech detected but no transcript was produced", {
        room: roomName,
        speechDurationMs: event.speechDuration,
      });

      session.say(voiceConfig.noQuestionMessage, {
        allowInterruptions: true,
        addToChatCtx: false,
      });
    });

    if (voiceConfig.logAudioEvents) {
      session.on(AgentSessionEventTypes.UserStateChanged, (event) => {
        console.log("[livekit:audio] User state changed", {
          room: roomName,
          from: event.oldState,
          to: event.newState,
        });
      });

      session.on(AgentSessionEventTypes.EotPrediction, (event) => {
        console.log("[livekit:turn] End-of-turn prediction", {
          room: roomName,
          probability: Number(event.probability.toFixed(3)),
          threshold: Number(event.threshold.toFixed(3)),
          delayMs: Math.round(event.delayMs),
        });
      });
    }

    session.on(AgentSessionEventTypes.Error, (event) => {
      console.error("[livekit:session] Voice pipeline error", {
        room: roomName,
        source: event.source?.label,
        error: event.error?.message || String(event.error),
      });
    });

    const agent = new LiveKitRagAgent({
      brand,
      appConfig: voiceConfig,
      tracePrefix: `livekit:${roomName}`,
    });

    console.log("[livekit] Starting RAG voice session", {
      room: roomName,
      brand: brand.key,
      stt: voiceConfig.sttModel,
      sttLanguage: voiceConfig.sttLanguage,
      tts: voiceConfig.ttsModel,
      vadActivationThreshold: voiceConfig.vadActivationThreshold,
      noiseCancellation: voiceConfig.noiseCancellationEnabled
        ? voiceConfig.noiseCancellationModel
        : "disabled",
    });

    await session.start({
      agent,
      room: context.room,
      inputOptions: inputOptions(),
    });
    await context.connect();
    session.say(voiceConfig.beginMessage, {
      allowInterruptions: true,
      addToChatCtx: true,
    });
  },
});

export default agentDefinition;

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: voiceConfig.agentName,
}));
