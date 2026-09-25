import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

export class ResponseDeadlineError extends Error {
  constructor(timeoutStage = "response.hard_deadline") {
    super("Response processing exceeded its time budget");
    this.name = "ResponseDeadlineError";
    this.code = "BOT_RESPONSE_TIMEOUT";
    this.timeoutStage = timeoutStage;
  }
}

export class ResponseCancelledError extends Error {
  constructor(reason = "external_abort") {
    super("Response processing was cancelled");
    this.name = "ResponseCancelledError";
    this.code = "BOT_RESPONSE_CANCELLED";
    this.cancellationReason = ["generation_completed", "generation_failed", "disposed"].includes(reason)
      ? reason : "external_abort";
  }
}

export function getResponseBudget() { return storage.getStore() || null; }
export function runWithResponseBudget(budget, operation) { return storage.run(budget, operation); }
// A queued job may be drained from another request's async context. Keep its
// own cancellation scope, just as timingLogger.bindTrace keeps attribution.
export function bindResponseBudget(operation) {
  const budget = getResponseBudget();
  return (...args) => runWithResponseBudget(budget, () => operation(...args));
}
export function isResponseTimeout(error) {
  return error?.code === "BOT_RESPONSE_TIMEOUT" || error?.code === "ABORT_ERR";
}

export function createResponseBudget({ receivedAt = Date.now(), timeoutMs = 15000,
  targetMs = timeoutMs, reserveMs = 2500, now = Date.now } = {}) {
  const controller = new AbortController();
  const responseDeadline = receivedAt + timeoutMs;
  const deadline = responseDeadline - reserveMs;
  const targetDeadline = receivedAt + Math.min(targetMs, timeoutMs);
  const budget = {
    signal: controller.signal, receivedAt, deadline, responseDeadline, targetDeadline,
    responseTargetMs: Math.min(targetMs, timeoutMs), responseHardTimeoutMs: timeoutMs,
    remaining: () => Math.max(0, deadline - now()),
    targetRemaining: () => Math.max(0, targetDeadline - now()),
    targetExceeded: () => now() >= targetDeadline,
    deliveryRemaining: () => Math.max(0, responseDeadline - now()),
    check() {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (now() >= deadline) throw new ResponseDeadlineError();
    },
    cancel(reason = "generation_completed") { controller.abort(new ResponseCancelledError(reason)); },
    dispose() { clearTimeout(timer); controller.abort(new ResponseCancelledError("disposed")); },
  };
  const timer = setTimeout(() => controller.abort(new ResponseDeadlineError()), Math.max(0, deadline - now()));
  return budget;
}

export function checkResponseBudget() { getResponseBudget()?.check(); }

/** Race AND signal the transport. A provider ignoring abort cannot return a
 * late result into the customer workflow. Always observes late rejections. */
export function runWithDeadline(operation, { timeoutMs, signal, stage = "operation" } = {}) {
  if (!signal && !Number.isFinite(timeoutMs)) return Promise.resolve().then(() => operation({}));
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const finish = (error, value) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) reject(error); else resolve(value);
    };
    const abort = () => {
      const error = signal?.aborted
        ? signal.reason instanceof ResponseDeadlineError || signal.reason instanceof ResponseCancelledError
          ? signal.reason : new ResponseCancelledError()
        : new ResponseDeadlineError(stage);
      controller.abort(error); finish(error);
    };
    if (signal?.aborted || (Number.isFinite(timeoutMs) && timeoutMs <= 0)) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    if (Number.isFinite(timeoutMs)) timer = setTimeout(abort, Math.max(1, timeoutMs));
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return operation({ signal: controller.signal, timeoutMs });
    }).then(value => finish(null, value), error => finish(error));
  });
}

export function runBudgetedIO(operation, stageTimeoutMs, stage = "operation") {
  const budget = getResponseBudget();
  if (!budget) return Promise.resolve().then(() => operation({ timeoutMs: stageTimeoutMs }));
  budget.check();
  const timeoutMs = Math.min(budget.remaining(), stageTimeoutMs ?? Infinity);
  return runWithDeadline(operation, { timeoutMs, signal: budget.signal, stage });
}

export function waitWithinBudget(milliseconds, signal = getResponseBudget()?.signal) {
  return runWithDeadline(({ signal: child }) => new Promise(resolve => {
    const timer = setTimeout(resolve, Math.max(0, milliseconds));
    child?.addEventListener("abort", () => clearTimeout(timer), { once: true });
  }), { signal });
}
