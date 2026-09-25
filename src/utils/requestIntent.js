// These recognize request forms, not product-name aliases or business facts.
// Catalog filters still come only from the current brand's stored labels.
export function isProductSelectionRequest(value) {
  const text = String(value || "").trim();
  if (/\b(?:suggest|recommend)\b.{0,60}\b(?:how to|steps?|instructions?|procedures?|repair|cleaning methods?)\b/i.test(text)) return false;
  return /^(?:(?:please|kindly)\s+)?(?:suggest|recommend)\b/i.test(text)
    || /\b(?:suggest|recommend|recommendations?|help me (?:choose|pick|select)|looking for|which .{0,100}(?:buy|choose|pick)|best .{0,100}(?:options?|products?|models?))\b/i.test(text);
}

export function mightRequestHumanSupport(value) {
  return /\b(?:agents?|human|person|staff|specialist|representatives?|tickets?|complaints?|claims?|escalat\w*|speak|talk|support team|customer service|someone|somebody)\b/i.test(String(value || ""));
}

export function isClearInformationRequest(value) {
  const text = String(value || "").trim();
  if (!text || mightRequestHumanSupport(text)) return false;
  return isProductSelectionRequest(text)
    || /^(?:(?:please|kindly)\s+)?(?:find|compare|show|list|describe|explain|tell me about|give me)\b/i.test(text)
    || /^(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening))[!.?\s]*$/i.test(text);
}
