import { RAG_CONFIG } from "../config/rag.js";
import { embedQuery } from "./voyageEmbeddingService.js";
import { searchKnowledgeChunks, searchStructuredProducts, getCatalogSummary } from "./knowledgeStoreService.js";
import { createQueryPlan } from "./queryPlanningService.js";
import { createRetrievalPipeline } from "./retrievalPipeline.js";

const pipeline = createRetrievalPipeline({
  config: RAG_CONFIG.retrieval,
  createQueryPlan,
  embedQuery,
  searchKnowledgeChunks,
  searchStructuredProducts,
  getCatalogSummary,
});

export const retrieveKnowledge = pipeline.retrieveKnowledge;
export const recoverKnowledge = pipeline.recoverKnowledge;
