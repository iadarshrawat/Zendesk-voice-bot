/**
 * conversationalFastPath.js
 *
 * Ultra-low-latency reply generator for purely conversational turns
 * (greetings, thanks, short acknowledgements) where no knowledge retrieval
 * is needed.  Uses claude-haiku with a tiny token cap so the caller hears
 * a reply in roughly 1 second instead of waiting for the full RAG pipeline.
 *
 * This module is intentionally minimal: one function, no retries, no budget
 * management.  The caller falls back to the full RAG pipeline on any error.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_CONFIG } from "../config/claude.js";

let client;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const SYSTEM_PROMPT =
  "You are a friendly voice-based customer support assistant. " +
  "The caller has said something conversational (a greeting, thanks, or brief acknowledgement). " +
  "Reply warmly and naturally in ONE short spoken sentence — no lists, no Markdown, no URLs. " +
  "Never promise actions you cannot take. Do not ask the caller to hold.";

/**
 * Generate a short spoken reply for a conversational turn.
 *
 * @param {{ brand: string, question: string, history?: string }} params
 * @returns {Promise<string>} Plain-text reply suitable for TTS
 */
export async function generateConversationalReply({ brand, question, history = "" }) {
  const userContent = JSON.stringify({
    brand,
    callerSaid: question,
    recentHistory: history || null,
  });

  const response = await getClient().messages.create({
    // Always use the fast haiku model regardless of the main answer model.
    model: CLAUDE_CONFIG.plannerModel || "claude-haiku-4-5-20251001",
    max_tokens: 80,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  }, {
    timeout: 5_000,
    maxRetries: 0,
  });

  if (response.stop_reason === "max_tokens") {
    // Trim to the last complete sentence if truncated.
    const raw = response.content?.filter((b) => b.type === "text").map((b) => b.text).join("") || "";
    const lastPeriod = raw.lastIndexOf(".");
    return lastPeriod > 0 ? raw.slice(0, lastPeriod + 1).trim() : raw.trim();
  }

  const text = response.content?.filter((b) => b.type === "text").map((b) => b.text).join("") || "";
  return text.trim();
}
