import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

// Explicit allowlists keep payloads, credentials, prompts and vectors out of
// tracing even if a caller accidentally passes them as additional metadata.
const TEXT_FIELDS = new Set([
  "traceId", "deliveryId", "conversationId", "messageId", "brandKey", "brandId",
  "model", "operation", "reason", "outcome", "intent", "supportGoal", "turnType",
  "plannerSource", "productResolution", "stopReason", "errorCode", "errorName",
  "keyHash", "serviceTier", "inferenceGeo", "route", "timeoutStage", "cancellationReason",
]);
const NUMBER_FIELDS = new Set([
  "attempt", "maxRetries", "delayMs", "timeoutMs", "inputChars", "historyChars",
  "stateChars", "systemChars", "evidenceChars", "requestChars", "replyChars",
  "productContextChars", "chunkContextChars", "products", "chunks", "sources",
  "candidates", "queryCount", "eventCount", "eventIndex", "fieldCount", "rows",
  "requestCharge", "httpStatus", "errorStatus", "dimensions", "batchSize",
  "hits", "misses", "coalesced", "expired", "evictions", "entries", "inFlight",
  "active", "pending", "concurrency", "ttlMs", "maxEntries", "maxTokens",
  "inputTokens", "outputTokens", "thinkingTokens", "cacheReadTokens",
  "cacheCreationTokens", "totalInputTokens", "sinceWebhookMs", "ragElapsedMs",
  "allowedLabelCount", "rejectedLabelCount", "normalizedLabelCount",
  "answerCalls", "citationRepairCalls", "contextBeforeChars", "contextSavedChars", "sharedValues",
  "durationMs", "cacheableEvidenceChars", "responseTargetMs", "responseHardTimeoutMs",
  "remainingMs", "targetRemainingMs",
]);
const BOOLEAN_FIELDS = new Set([
  "enabled", "broadened", "hasMore", "requiresProductIdentity", "repairFormat",
  "recovery", "withinHours", "found", "acquired", "quickRepliesEnabled", "targetExceeded",
]);

function safeMetadata(metadata = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (TEXT_FIELDS.has(key) && (typeof value === "string" || typeof value === "number")) {
      safe[key] = String(value).replace(/[\r\n\t]/g, " ").slice(0, 200);
    } else if (NUMBER_FIELDS.has(key) && typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
    } else if (BOOLEAN_FIELDS.has(key) && typeof value === "boolean") {
      safe[key] = value;
    } else if (["allowedLabels", "rejectedLabels"].includes(key) && Array.isArray(value)) {
      safe[key] = value.filter(label => typeof label === "string"
        && /^(?:(?:PRODUCT|SOURCE) [1-9]\d{0,8}|CATALOG SUMMARY|UNRECOGNIZED [a-f0-9]{12})$/.test(label)).slice(0, 12);
    }
  }
  return safe;
}

export function safeErrorMetadata(error) {
  try {
    const status = Number(error?.response?.status ?? error?.statusCode ?? error?.status);
    const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code : null;
    const name = typeof error?.name === "string" && /^[A-Za-z]{1,64}$/.test(error.name)
      ? error.name : "Error";
    return { errorName: name, ...(code ? { errorCode: code } : {}),
      ...(error?.name === "ResponseDeadlineError" && typeof error.timeoutStage === "string"
        && /^(response\.hard_deadline|operation|mysql\.(operation|state_load|state_save)|claude\.(planner|classifier|answer|citation_repair))$/.test(error.timeoutStage)
        ? { timeoutStage: error.timeoutStage } : {}),
      ...(error?.name === "ResponseCancelledError"
        && ["generation_completed", "generation_failed", "disposed", "external_abort"].includes(error.cancellationReason)
        ? { cancellationReason: error.cancellationReason } : {}),
      ...(status >= 100 && status <= 599 ? { errorStatus: status } : {}) };
  } catch { return { errorName: "Error" }; }
}

/** Injectable writer/clock make the actual logger testable without providers. */
export function createTimingLogger({
  write = record => console.log("BOT TRACE", JSON.stringify(record)),
  enabled = () => !["false", "0", "off"].includes(String(process.env.BOT_TIMING_LOGS || "true").trim().toLowerCase()),
  clock = () => performance.now(), timestamp = () => new Date().toISOString(),
} = {}) {
  const storage = new AsyncLocalStorage();
  let sequence = 0;

  function emit(stage, phase, metadata, context = storage.getStore() || {}, extra = {}) {
    try {
      if (!enabled()) return;
      const elapsed = clock();
      const sinceWebhookMs = Number.isFinite(context.webhookStartedAt)
        ? Math.max(0, Math.round(elapsed - context.webhookStartedAt)) : undefined;
      const sinceTraceStartMs = Number.isFinite(context.startedAt)
        ? Math.max(0, Math.round(elapsed - context.startedAt)) : undefined;
      write({ timestamp: timestamp(), processId: process.pid, ...safeMetadata(context),
        stage, phase, ...safeMetadata(metadata), ...extra,
        ...(sinceWebhookMs !== undefined ? { sinceWebhookMs } : {}),
        ...(sinceTraceStartMs !== undefined ? { sinceTraceStartMs } : {}) });
    } catch { /* Observability must never break a customer turn. */ }
  }

  function logStage(stage, metadata = {}) { emit(stage, "event", metadata); }

  function startStage(stage, metadata = {}) {
    const context = storage.getStore() || {};
    const started = clock();
    const spanId = `${process.pid}:${++sequence}`;
    let ended = false;
    emit(stage, "start", metadata, context, { spanId });
    const finish = (status, details = {}) => {
      if (ended) return;
      ended = true;
      emit(stage, "end", { ...metadata, ...details }, context,
        { spanId, status, durationMs: Math.max(0, Math.round(clock() - started)) });
    };
    return { end: (details = {}) => finish("ok", details),
      fail: (error, details = {}) => finish(error?.code === "BOT_RESPONSE_CANCELLED" ? "cancelled" : "error",
        { ...details, ...safeErrorMetadata(error) }) };
  }

  async function measureStage(stage, operation, metadata = {}) {
    const span = startStage(stage, metadata);
    try { const result = await operation(); span.end(); return result; }
    catch (error) { span.fail(error); throw error; }
  }

  function measureSyncStage(stage, operation, metadata = {}) {
    const span = startStage(stage, metadata);
    try { const result = operation(); span.end(); return result; }
    catch (error) { span.fail(error); throw error; }
  }

  function runWithTrace(metadata, operation) {
    const parent = metadata.fresh ? {} : storage.getStore() || {};
    const traceId = metadata.traceId || parent.traceId || randomUUID();
    const startedAt = parent.startedAt ?? clock();
    return storage.run({ ...parent, startedAt,
      webhookStartedAt: metadata.route === "webhook" ? startedAt : parent.webhookStartedAt,
      ...metadata, traceId, deliveryId: metadata.deliveryId || parent.deliveryId || traceId }, operation);
  }

  // Scheduled provider jobs can start from another customer's drain callback.
  // Bind their original context so attribution never follows that other job.
  function bindTrace(operation) {
    const context = storage.getStore();
    return (...args) => storage.run(context, () => operation(...args));
  }

  function logModelUsage(stage, response, metadata = {}) {
    const usage = response?.usage || {};
    const input = Number(usage.input_tokens) || 0;
    const read = Number(usage.cache_read_input_tokens) || 0;
    const created = Number(usage.cache_creation_input_tokens) || 0;
    logStage(stage, { ...metadata, model: response?.model || metadata.model,
      stopReason: response?.stop_reason, inputTokens: input,
      cacheReadTokens: read, cacheCreationTokens: created,
      totalInputTokens: input + read + created,
      outputTokens: Number(usage.output_tokens) || 0,
      thinkingTokens: Number(usage.output_tokens_details?.thinking_tokens) || 0,
      serviceTier: usage.service_tier, inferenceGeo: usage.inference_geo });
  }

  return { logStage, startStage, measureStage, measureSyncStage, runWithTrace,
    bindTrace, logModelUsage, getTraceContext: () => storage.getStore() || {} };
}

export const { logStage, startStage, measureStage, measureSyncStage,
  runWithTrace, bindTrace, logModelUsage, getTraceContext } = createTimingLogger();
