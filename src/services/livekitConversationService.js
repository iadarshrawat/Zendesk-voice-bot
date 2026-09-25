import { buildRagTurn } from "../transcript.js";
import { formatReplyForSpeech } from "../voiceFormatter.js";
import { normalizeConversationState, updateConversationState } from "../utils/conversationContext.js";
import {
  createResponseBudget,
  isResponseTimeout,
  runWithResponseBudget,
} from "../utils/responseBudget.js";

function safeQuestion(value) {
  return typeof value === "string" ? value.trim() : "";
}

export class LiveKitConversationService {
  constructor({
    brand,
    appConfig,
    generateVoiceReply,
    speak,
    tracePrefix = "livekit",
  }) {
    this.brand = brand;
    this.appConfig = appConfig;
    this.generateVoiceReply = generateVoiceReply;
    this.speak = speak;
    this.tracePrefix = tracePrefix;
    this.transcript = [];
    this.conversationState = normalizeConversationState();
    this.activeTurn = null;
    this.turnCounter = 0;
  }

  async handleUserTurn(value) {
    const question = safeQuestion(value);
    if (!question) {
      this.safeSpeak(this.appConfig.noQuestionMessage, { kind: "no_question" });
      return this.appConfig.noQuestionMessage;
    }

    this.cancelActiveTurn();
    this.transcript.push({ role: "user", content: question });
    const turnInput = buildRagTurn(this.transcript, this.appConfig.maxHistoryChars);
    const turnNumber = ++this.turnCounter;
    const traceId = `${this.tracePrefix}:${turnNumber}`;
    const budget = createResponseBudget({
      timeoutMs: this.appConfig.responseHardTimeoutMs,
      targetMs: this.appConfig.responseTargetMs,
      reserveMs: this.appConfig.responseReserveMs,
    });
    const turn = { turnNumber, traceId, budget, thinkingTimer: null };
    this.activeTurn = turn;

    if (this.appConfig.thinkingMessage) {
      turn.thinkingTimer = setTimeout(() => {
        if (this.activeTurn === turn) {
          this.safeSpeak(this.appConfig.thinkingMessage, {
            kind: "thinking",
            addToChatCtx: false,
          });
        }
      }, this.appConfig.thinkingDelayMs);
    }

    const startedAt = Date.now();
    try {
      const result = await runWithResponseBudget(budget, () => this.generateVoiceReply({
        brand: this.brand.displayName,
        history: turnInput.history,
        question: turnInput.question,
        conversationState: this.conversationState,
        traceId,
      }));

      if (this.activeTurn !== turn) return null;
      clearTimeout(turn.thinkingTimer);
      const spokenReply = formatReplyForSpeech(result?.reply) || this.appConfig.errorMessage;
      this.transcript.push({ role: "agent", content: spokenReply });

      if (result?.plan) {
        this.conversationState = updateConversationState(
          this.conversationState,
          turnInput.question,
          result.plan,
          result,
          traceId,
        );
      }

      this.safeSpeak(spokenReply, { kind: "answer" });
      console.log("[livekit:rag] Reply completed", {
        traceId,
        brand: this.brand.key,
        status: result?.status,
        elapsedMs: Date.now() - startedAt,
        replyChars: spokenReply.length,
      });
      return spokenReply;
    } catch (error) {
      if (this.activeTurn !== turn) return null;
      clearTimeout(turn.thinkingTimer);
      const fallback = isResponseTimeout(error)
        ? this.appConfig.timeoutMessage
        : this.appConfig.errorMessage;
      this.transcript.push({ role: "agent", content: fallback });
      this.safeSpeak(fallback, { kind: "error" });
      console.error("[livekit:rag] Reply failed", {
        traceId,
        timeout: isResponseTimeout(error),
        timeoutStage: error?.timeoutStage,
        error: error?.message,
      });
      return fallback;
    } finally {
      clearTimeout(turn.thinkingTimer);
      if (this.activeTurn === turn) this.activeTurn = null;
      budget.dispose();
    }
  }

  safeSpeak(text, options = {}) {
    if (!text) return;
    try {
      const result = this.speak(text, options);
      if (result && typeof result.catch === "function") {
        result.catch((error) => console.error("[livekit:tts] Speech failed", {
          kind: options.kind,
          error: error?.message,
        }));
      }
    } catch (error) {
      console.error("[livekit:tts] Speech scheduling failed", {
        kind: options.kind,
        error: error?.message,
      });
    }
  }

  cancelActiveTurn() {
    if (!this.activeTurn) return;
    clearTimeout(this.activeTurn.thinkingTimer);
    this.activeTurn.budget.cancel("external_abort");
    this.activeTurn = null;
  }

  close() {
    this.cancelActiveTurn();
  }
}
