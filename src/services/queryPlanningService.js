import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_CONFIG } from "../config/claude.js";
import { RAG_CONFIG } from "../config/rag.js";
import { parseJsonObject } from "../utils/jsonResponse.js";
import { buildHeuristicQueryPlan, buildPlannerMessages, normalizeQueryPlan } from "../utils/queryPlan.js";
import { logStage, measureStage, measureSyncStage, logModelUsage } from "../utils/timingLogger.js";
import { runBudgetedIO, getResponseBudget, checkResponseBudget } from "../utils/responseBudget.js";
import { claudeOutputOptions } from "../utils/claudeOutput.js";

export { buildHeuristicQueryPlan } from "../utils/queryPlan.js";

let client;

export async function createQueryPlan(question, options = {}) {
  const fallback = measureSyncStage("planner.heuristic", () => buildHeuristicQueryPlan(question, options));
  if (!RAG_CONFIG.retrieval.queryPlanningEnabled || !process.env.ANTHROPIC_API_KEY) {
    logStage("planner.skipped", { reason: !RAG_CONFIG.retrieval.queryPlanningEnabled
      ? "disabled" : "api_key_not_configured", plannerSource: "heuristic" });
    return fallback;
  }
  try {
    client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = CLAUDE_CONFIG.plannerModel || CLAUDE_CONFIG.model;
    const messages = buildPlannerMessages(question, options);
    const cap = getResponseBudget() ? Math.min(RAG_CONFIG.retrieval.plannerTimeoutMs,
      RAG_CONFIG.conversation?.plannerStageTimeoutMs ?? 6000) : RAG_CONFIG.retrieval.plannerTimeoutMs;
    const response = await measureStage("claude.planner", () => runBudgetedIO(({ signal, timeoutMs }) => client.messages.create({
      model,
      max_tokens: 1600,
      ...(getResponseBudget() ? claudeOutputOptions(model, {
        effort: RAG_CONFIG.conversation?.plannerEffort ?? "low" }) : {}),
      // Some configured models reject temperature. Omit the optional parameter
      // instead of spending a failed request and falling back on every turn.
      ...messages,
    }, { timeout: timeoutMs, maxRetries: 0, ...(signal ? { signal } : {}) }), cap, "claude.planner"), {
      model, maxTokens: 1600, maxRetries: 0, timeoutMs: cap,
      systemChars: messages.system.length,
      remainingMs: getResponseBudget()?.remaining(), targetRemainingMs: getResponseBudget()?.targetRemaining() });
    logModelUsage("claude.planner_usage", response, { model });
    if (response.stop_reason === "max_tokens") throw new Error("Query plan was truncated");
    const text = response.content?.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    return measureSyncStage("planner.parse", () => ({
      ...normalizeQueryPlan(parseJsonObject(text), question), plannerSource: "llm" }));
  } catch (error) {
    checkResponseBudget();
    logStage("planner.fallback", { reason: error?.status === 429 ? "rate_limited" : "unavailable_or_invalid",
      timeoutStage: error.timeoutStage,
      plannerSource: "heuristic" });
    console.warn("Query planning failed; using conservative fallback:", error.message);
    return { ...fallback, plannerError: error?.status === 429 ? "rate_limited" : "planner_unavailable_or_invalid" };
  }
}
