// These are the same answer-visible fields as the previous backend. No
// retrieved candidate, unique field value, manual instruction or condition is
// discarded. This is representation compaction, not a semantic summarizer.
const PRODUCT_FIELDS = ["productId", "alternateProductIds", "modelIds", "productName", "manufacturerBrand", "distributor", "category", "productUse", "useCases", "materials", "colors", "price", "physicalForm", "flammability", "ingredients", "features", "description", "ragSummary", "specifications", "attributes", "warrantyMonths", "availability", "manualPaths"];

export function productEvidence(product) {
  return Object.fromEntries(PRODUCT_FIELDS.filter(name => {
    const value = product[name];
    return value != null && value !== "" && (!Array.isArray(value) || value.length > 0);
  }).map(name => [name, product[name]]));
}

export function renderProductEvidence(products, { compact = true } = {}) {
  const originals = products.map(productEvidence);
  const render = rows => rows.map((product, index) => `[PRODUCT ${index + 1}] ${JSON.stringify(product)}`).join("\n");
  const full = render(originals);
  if (!compact) return { text: full, beforeChars: full.length, savedChars: 0, sharedValues: 0 };
  const counts = new Map();
  function visit(value) {
    const serialized = JSON.stringify(value);
    if (serialized?.length >= 100) {
      const entry = counts.get(serialized) || { value, count: 0 };
      entry.count++; counts.set(serialized, entry);
    }
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  }
  // The root of a row is never replaced; its label and identity stay visible.
  const identityFields = new Set(["productId", "productName", "modelIds", "alternateProductIds", "manufacturerBrand"]);
  originals.forEach(product => Object.entries(product).forEach(([key, value]) => { if (!identityFields.has(key)) visit(value); }));
  const candidates = [...counts.entries()].filter(([serialized, entry]) =>
    entry.count > 1 && (entry.count - 1) * serialized.length > entry.count * 40 + 30)
    .sort((a, b) => b[0].length - a[0].length);
  const dictionary = new Map(candidates.map(([serialized, entry], index) =>
    [serialized, { key: `V${index + 1}`, value: entry.value }]));
  const used = new Set();
  function encode(value) {
    const shared = dictionary.get(JSON.stringify(value));
    if (shared) { used.add(shared.key); return { $evidenceRef: shared.key }; }
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object") {
      // Escape real source objects with a reserved marker rather than treating
      // their original contents as a dictionary reference.
      if (Object.hasOwn(value, "$evidenceRef") || Object.hasOwn(value, "$evidenceLiteral")) {
        return { $evidenceLiteral: value };
      }
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)]));
    }
    return value;
  }
  const rows = originals.map(product => Object.fromEntries(Object.entries(product).map(([key, value]) =>
    [key, identityFields.has(key) ? value : encode(value)])));
  const shared = Object.fromEntries([...dictionary.values()].filter(entry => used.has(entry.key)).map(entry => [entry.key, entry.value]));
  const text = used.size ? `SHARED EVIDENCE VALUES (exact original values; {"$evidenceRef":"Vn"} means the value stored under Vn; {"$evidenceLiteral":value} means literal original data, not a reference):\n${JSON.stringify(shared)}\n${render(rows)}` : full;
  // A small catalog or an unusual shape may not benefit. Never enlarge it.
  return text.length < full.length
    ? { text, beforeChars: full.length, savedChars: full.length - text.length, sharedValues: used.size }
    : { text: full, beforeChars: full.length, savedChars: 0, sharedValues: 0 };
}

export function responseGuidance(rag, question = "", history = "") {
  const asksForAll = rag.plan?.mustReturnAll === true
    || /\b(all|every|complete|exhaustive)\b|\bsaare\b|\bsabhi\b|सभी|सारे/i.test(`${question} ${history}`);
  // Be conservative: even a number referring to room size disables the soft
  // shortlist preference. Never accidentally cap an explicitly requested list.
  const explicitQuantity = /\b\d+\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty)\b/i.test(`${question} ${history}`);
  const selection = rag.plan?.intent === "product_search" && rag.plan?.supportGoal === "selection"
    && !rag.plan?.requiresProductIdentity && !asksForAll && !explicitQuantity;
  return selection ? "Give 3–5 supported options at most, fewer if appropriate; one short practical reason per option. Do not assume suitability, price, noise level, stock, or any unstated requirement. Respect the requested number and comparisons; ask one useful question if needed. State that this is a shortlist, not all matching products."
    : "Answer the requested scope concisely. Preserve requested comparisons, complete-list requests, exact specifications, prerequisites, exceptions and applicable manual steps. Never shorten by omitting a necessary condition or instruction.";
}
