export function formatReplyForSpeech(value) {
  if (typeof value !== "string") return "";

  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*Sources?:.*$/gim, " ")
    .replace(/\[([^\]]+)]\((?:https?:\/\/)?[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*(\d{1,3})[.)]\s+/gm, "$1. ")
    .replace(/\btype\s+(['\"]?)connect me to an agent\1/gi, "say 'connect me to an agent'")
    .replace(/[\r\n]+/g, ". ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}
