const normalize = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const compact = value => normalize(value).replace(/ /g, "");

export function resolveProductReference(reference, products = [], { truncated = false } = {}) {
  if (!reference) return { status: "none", products: [] };
  const needle = compact(reference);
  const distinct = [...new Map(products.filter(p => p.productId).map(p => [normalize(p.productId), p])).values()];
  const exact = distinct.filter(p => [p.productId, ...(p.alternateProductIds || []), ...(p.modelIds || []), p.productName]
    .some(value => compact(value) === needle));
  if (exact.length) {
    // An exact canonical SKU can resolve a product in a partial catalog. A name
    // may have unseen duplicates, so it must not establish uniqueness there.
    const canonicalId = exact.length === 1 && normalize(exact[0].productId) === normalize(reference);
    return { status: exact.length > 1 ? "ambiguous" : truncated && !canonicalId ? "unresolved" : "resolved", products: exact };
  }
  const normalizedReference = normalize(reference);
  const embedded = distinct.filter((product) => [
    product.productId,
    ...(product.alternateProductIds || []),
    ...(product.modelIds || []),
  ].some((identifier) => {
    const value = normalize(identifier);
    if (!value) return false;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^| )${escaped}( |$)`, "u").test(normalizedReference);
  }));
  if (embedded.length) {
    const canonicalId = embedded.length === 1
      && new RegExp(`(^| )${normalize(embedded[0].productId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`, "u")
        .test(normalizedReference);
    return {
      status: embedded.length > 1 ? "ambiguous" : truncated && !canonicalId ? "unresolved" : "resolved",
      products: embedded,
    };
  }
  const terms = new Set(normalize(reference).split(" ").filter(Boolean));
  if (terms.size < 3) return { status: "unresolved", products: [] };
  const ranked = distinct.map(product => {
    const name = new Set(normalize(product.productName).split(" ").filter(Boolean));
    const overlap = [...terms].filter(term => name.has(term)).length;
    return { product, overlap, score: 2 * overlap / (terms.size + name.size) };
  }).filter(row => row.overlap >= 3 && row.score >= 0.72).sort((a, b) => b.score - a.score);
  if (!ranked.length) return { status: "unresolved", products: [] };
  if (truncated) return { status: "unresolved", products: ranked.slice(0, 4).map(r => r.product) };
  if (ranked[1] && ranked[0].score - ranked[1].score < 0.12) return { status: "ambiguous", products: ranked.slice(0, 4).map(r => r.product) };
  return { status: "resolved", products: [ranked[0].product] };
}

export function productIdentifiers(identity) {
  return identity?.status === "resolved"
    ? [...new Set(identity.products.flatMap(p => [p.productId, ...(p.alternateProductIds || [])]).filter(Boolean).map(v => String(v).toLowerCase()))]
    : [];
}

export function isConflictingProductChunk(chunk, identity) {
  const ids = productIdentifiers(identity);
  if (!ids.length || chunk.documentScope === "brand") return false;
  const scoped = chunk.documentScope === "product";
  const chunkIds = [...new Set([
    ...(chunk.productIds || []),
    chunk.productId,
    ...(chunk.alternateProductIds || []),
  ].filter(Boolean).map(v => String(v).toLowerCase()))];
  if (!scoped || !chunkIds.length) return false;
  return !chunkIds.some(id => ids.includes(id));
}
