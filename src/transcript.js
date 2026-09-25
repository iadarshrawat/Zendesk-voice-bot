function cleanUtterance(value) {
  if (!value || typeof value !== "object") return null;
  const role = value.role === "agent" || value.role === "user" ? value.role : null;
  const content = typeof value.content === "string" ? value.content.trim() : "";
  return role && content ? { role, content } : null;
}

export function normalizeTranscript(value) {
  return (Array.isArray(value) ? value : []).map(cleanUtterance).filter(Boolean);
}

function trimHistory(lines, maxChars) {
  const selected = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const cost = line.length + (selected.length ? 1 : 0);
    if (selected.length && used + cost > maxChars) break;
    selected.unshift(line.slice(-maxChars));
    used += cost;
    if (used >= maxChars) break;
  }
  return selected.join("\n").slice(-maxChars);
}

export function buildRagTurn(transcript, maxHistoryChars = 16_000) {
  const utterances = normalizeTranscript(transcript);
  let latestUserIndex = -1;
  for (let index = utterances.length - 1; index >= 0; index -= 1) {
    if (utterances[index].role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  if (latestUserIndex < 0) return { question: "", history: "", utterances };

  const historyLines = utterances.slice(0, latestUserIndex).map((utterance) =>
    `${utterance.role === "user" ? "Customer" : "Assistant"}: ${utterance.content}`);

  return {
    question: utterances[latestUserIndex].content,
    history: trimHistory(historyLines, maxHistoryChars),
    utterances,
  };
}
