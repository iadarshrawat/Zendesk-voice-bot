import { Agent } from "@livekit/agents";

import { LiveKitConversationService } from "./services/livekitConversationService.js";
import { generateVoiceRagReply } from "./services/voiceRagService.js";

export class LiveKitRagAgent extends Agent {
  constructor({ brand, appConfig, tracePrefix, generateVoiceReply = generateVoiceRagReply }) {
    super({
      instructions: "Use the external grounded RAG pipeline for every customer response.",
      llm: null,
    });

    this.conversation = new LiveKitConversationService({
      brand,
      appConfig,
      tracePrefix,
      generateVoiceReply,
      speak: (text, options = {}) => this.session.say(text, {
        allowInterruptions: true,
        addToChatCtx: options.addToChatCtx ?? true,
      }),
    });
  }

  async onUserTurnCompleted(_chatContext, newMessage) {
    await this.conversation.handleUserTurn(newMessage.rawTextContent || "");
  }

  async onExit() {
    this.conversation.close();
  }
}
