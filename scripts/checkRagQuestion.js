import "dotenv/config";

import { requireSupportBrand } from "../src/config/brands.js";
import { verifyKnowledgeStore } from "../src/config/cosmos.js";
import { getMissingVoiceRagConfiguration, voiceConfig } from "../src/config/voice.js";
import { generateVoiceRagReply } from "../src/services/voiceRagService.js";
import { createResponseBudget, runWithResponseBudget } from "../src/utils/responseBudget.js";
import { formatReplyForSpeech } from "../src/voiceFormatter.js";

function valueFor(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function run() {
  const question = valueFor("--question");
  const brand = requireSupportBrand(valueFor("--brand") || voiceConfig.defaultBrand);
  if (!question?.trim()) {
    throw new Error('Usage: npm run rag:check -- --brand "Mr Brand" --question "Which fan is suitable for a school?"');
  }

  const missing = getMissingVoiceRagConfiguration();
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}`);
  await verifyKnowledgeStore();

  const budget = createResponseBudget({
    timeoutMs: voiceConfig.responseHardTimeoutMs,
    targetMs: voiceConfig.responseTargetMs,
    reserveMs: voiceConfig.responseReserveMs,
  });
  try {
    const result = await runWithResponseBudget(budget, () => generateVoiceRagReply({
      brand: brand.displayName,
      question: question.trim(),
      history: "",
      conversationState: {},
      traceId: "local-rag-check",
    }));
    console.log(`Status: ${result.status}`);
    console.log(`Reply: ${formatReplyForSpeech(result.reply)}`);
  } finally {
    budget.dispose();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
