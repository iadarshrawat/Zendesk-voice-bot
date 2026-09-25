import { createHash } from "node:crypto";

// Formatting aliases only: never infer a source from a filename, product ID,
// similarity, neighbouring number, or another brand's evidence.
export function canonicalEvidenceLabel(value) {
  if (typeof value !== "string" || value.length > 120) return null;
  let label = value.trim().toUpperCase();
  if ((label.startsWith("[") && label.endsWith("]"))
    || (label.startsWith("(") && label.endsWith(")"))) label = label.slice(1, -1).trim();
  if (/^CATALOG[\s_-]+SUMMARY$/.test(label)) return "CATALOG SUMMARY";
  const match = /^(PRODUCT|SOURCE)(?:\s*[:#_]\s*|\s+|-)?(\d{1,9})$/.exec(label);
  const number = match ? Number(match[2]) : 0;
  return number > 0 ? `${match[1]} ${number}` : null;
}

export function allowedEvidenceLabels(rag) {
  return [...new Set((rag.sources || []).map(source => canonicalEvidenceLabel(source.label)).filter(Boolean))];
}

export function resolveEvidenceLabels(values, rag) {
  const allowed = allowedEvidenceLabels(rag);
  const allowedSet = new Set(allowed);
  const supplied = Array.isArray(values) ? [...new Set(values)] : [];
  const accepted = []; const rejected = []; let normalizedCount = 0;
  for (const value of supplied) {
    const canonical = canonicalEvidenceLabel(value);
    if (!canonical || !allowedSet.has(canonical)) rejected.push(value);
    else {
      if (value !== canonical) normalizedCount++;
      if (!accepted.includes(canonical)) accepted.push(canonical);
    }
  }
  return { allowed, accepted, rejected, normalizedCount };
}

// Unknown labels can contain customer text or credentials. Log a digest, not
// that text. Known grammar is safe and useful even when the number is invalid.
export function safeLabelDiagnostics(values, limit = 12) {
  return (Array.isArray(values) ? values : []).slice(0, Math.min(12, limit)).map(value =>
    canonicalEvidenceLabel(value) || `UNRECOGNIZED ${createHash("sha256")
      .update(typeof value === "string" ? value : JSON.stringify(value) ?? String(value)).digest("hex").slice(0, 12)}`);
}
