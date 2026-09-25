import { buildRagTurn } from "../transcript.js";
import { formatReplyForSpeech } from "../voiceFormatter.js";
import { normalizeConversationState, updateConversationState } from "../utils/conversationContext.js";
import {
  createResponseBudget,
  isResponseTimeout,
  runWithResponseBudget,
} from "../utils/responseBudget.js";
import { buildHeuristicQueryPlan } from "../utils/queryPlan.js";
import { generateConversationalReply } from "./conversationalFastPath.js";

function safeQuestion(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Quick heuristic: is this a conversational turn that needs no RAG lookup?
 * We use the same lightweight planner that already runs inside the retrieval
 * pipeline so the classification is always consistent.
 */
function isFastPathTurn(question) {
  try {
    const plan = buildHeuristicQueryPlan(question);
    return plan.turnType === "conversation" || plan.supportGoal === "conversation";
  } catch {
    return false;
  }
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

    // ── Fast path ──────────────────────────────────────────────────────────
    // Greetings, thank-yous, and other purely conversational turns carry no
    // retrieval need.  Skip the full RAG pipeline and reply directly with a
    // tiny Haiku call so the caller hears an answer in ~1 s with no
    // "please wait" message.
    if (isFastPathTurn(question)) {
      const turnNumber = ++this.turnCounter;
      const traceId = `${this.tracePrefix}:${turnNumber}:fast`;
      const turn = { turnNumber, traceId, budget: null, thinkingTimer: null };
      this.activeTurn = turn;
      try {
        const reply = await generateConversationalReply({
          brand: this.brand.displayName,
          question,
          history: this.transcript.slice(-6).map((m) => `${m.role}: ${m.content}`).join("\n"),
        });
        if (this.activeTurn !== turn) return null;
        const spokenReply = reply || this.appConfig.errorMessage;
        this.transcript.push({ role: "agent", content: spokenReply });
        this.safeSpeak(spokenReply, { kind: "answer" });
        console.log("[livekit:fast] Conversational reply", { traceId, brand: this.brand.key });
        return spokenReply;
      } catch (error) {
        if (this.activeTurn !== turn) return null;
        // Fall through to the full RAG pipeline on any error.
        console.warn("[livekit:fast] Fast-path failed, falling back to RAG:", error?.message);
        this.transcript.pop(); // remove the user turn we pushed; RAG will re-push it
      } finally {
        if (this.activeTurn === turn) this.activeTurn = null;
      }
    }
    // ── Full RAG pipeline ──────────────────────────────────────────────────
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
    // Fast-path turns have no budget; only cancel if one exists.
    this.activeTurn.budget?.cancel("external_abort");
    this.activeTurn = null;
  }

  close() {
    this.cancelActiveTurn();
  }
}
