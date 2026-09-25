/** Parse a JSON object returned as text, allowing an optional Markdown fence. */
export function parseJsonObject(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Expected a JSON object");
  const value = JSON.parse(cleaned.slice(start, end + 1));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return value;
}
