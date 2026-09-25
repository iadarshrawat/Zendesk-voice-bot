import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

export const CLAUDE_CONFIG = {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.CLAUDE_MODEL?.trim() || 'claude-sonnet-5',
  // Routing/planning never need the full answer model. Both are independently
  // overridable; the answer, audit and existing business workflows stay put.
  plannerModel: process.env.CLAUDE_PLANNER_MODEL?.trim() || 'claude-haiku-4-5-20251001',
  classifierModel: process.env.CLAUDE_CLASSIFIER_MODEL?.trim() || 'claude-haiku-4-5-20251001',
  baseUrl: 'https://api.anthropic.com/v1',
  version: '2023-06-01',
  maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS) || 2048,
};

/**
 * Validate Claude configuration on startup
 */
function validateClaudeConfig() {
  const required = ['ANTHROPIC_API_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn("⚠️ Anthropic Claude credentials missing");
    console.warn(`💡 Missing: ${missing.join(', ')}`);
    console.warn("💡 Claude answers, query planning, and CSAT scoring will not work");
    return false;
  }
  return true;
}

// Validate on import
const isConfigured = validateClaudeConfig();

// ============================================================================
// CLAUDE API CLIENT
// ============================================================================

/**
 * Create Claude API client for Files and Messages APIs
 * @throws {Error} If Claude credentials not configured
 */
export function createClaudeClient() {
  if (!isConfigured) {
    throw new Error(
      "Anthropic Claude credentials not configured. Set ANTHROPIC_API_KEY in .env"
    );
  }

  return axios.create({
    baseURL: CLAUDE_CONFIG.baseUrl,
    headers: {
      'x-api-key': CLAUDE_CONFIG.apiKey,
      'anthropic-version': CLAUDE_CONFIG.version,
      'content-type': 'application/json',
    },
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Sleep utility for rate limiting and retries
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { isConfigured };
