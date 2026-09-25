const clean = (value, limit = 1200) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const comparable = value => clean(value, 20000).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");

export function normalizeConversationState(value = {}) {
  if (!value || typeof value !== "object") value = {};
  return {
    activeRequest: clean(value.activeRequest),
    productReference: clean(value.productReference, 200),
    pendingQuestion: clean(value.pendingQuestion, 800),
    facts: (Array.isArray(value.facts) ? value.facts : []).filter(f =>
      f && typeof f.key === "string" && typeof f.value === "string" && typeof f.evidence === "string").slice(-24)
      .map(f => ({ key: clean(f.key, 64), value: clean(f.value, 300), evidence: clean(f.evidence, 600), messageId: clean(f.messageId, 128) })),
  };
}

// Facts must quote the current customer's actual words. Inferences such as
// retailer authorization and policy eligibility never become customer facts.
export function updateConversationState(previous, question, plan = {}, answer = {}, messageId = null) {
  const reset = plan.topicChanged === true;
  const state = normalizeConversationState(reset ? {} : previous);
  if (reset || !state.activeRequest) state.activeRequest = clean(question);
  const facts = new Map(state.facts.map(f => [f.key, f]));
  for (const fact of Array.isArray(plan.caseFacts) ? plan.caseFacts : []) {
    const key = clean(fact?.key, 64).toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const value = clean(fact?.value, 300);
    const evidence = clean(fact?.evidence, 600);
    if (!key || !value || !evidence || !comparable(question).includes(comparable(evidence))
      || !comparable(evidence).includes(comparable(value))) continue;
    facts.set(key, { key, value, evidence, messageId });
  }
  state.facts = [...facts.values()].slice(-24);
  const reference = clean(plan.filters?.productName, 200);
  const customerEvidence = [question, ...state.facts.map(f => f.evidence)].join("\n");
  if (reference && comparable(customerEvidence).includes(comparable(reference))) state.productReference = reference;
  if (reset && !reference) state.productReference = "";
  state.pendingQuestion = answer.status === "clarify"
    ? clean(answer.pendingQuestion || answer.reply, 800) : clean(answer.pendingQuestion, 800);
  return state;
}

export function contextualFallbackQuery(question, history = "", state = {}) {
  const memory = normalizeConversationState(state);
  if (!history && !memory.activeRequest && !memory.pendingQuestion) return String(question).slice(0, 1000);
  const context = [
    memory.activeRequest && `Active customer request: ${memory.activeRequest.slice(0, 250)}`,
    memory.productReference && `Customer product: ${memory.productReference}`,
    memory.pendingQuestion && `Assistant asked: ${memory.pendingQuestion.slice(0, 250)}`,
    !memory.activeRequest && history && `Recent conversation: ${String(history).slice(-450)}`,
  ].filter(Boolean).join("\n").slice(0, 900);
  return `${context}\nLatest customer message: ${String(question).slice(0, 600)}`;
}
