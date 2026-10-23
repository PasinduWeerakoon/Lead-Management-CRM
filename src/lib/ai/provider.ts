import * as anthropic from './anthropic'
import {
  compatGenerateFilters,
  compatHqBatch,
  compatScoreBatch,
  compatStructured,
  listCompatModels,
  testCompatKey,
} from './openai-compat'
import { modelById, type CustomModel, type Provider } from './models'

/**
 * One entry point for AI calls. The chosen model decides which provider handles the request, so
 * features (describe-to-filter, scoring, company HQ) never need to know which one is in use.
 * Anthropic uses its own SDK; OpenAI, Gemini, Groq and OpenRouter share the OpenAI-compatible client.
 */
export { AiError } from './anthropic'
export type {
  FilterRequest,
  FilterResponse,
  HqBatchRequest,
  HqBatchResponse,
  ScoreBatchRequest,
  ScoreBatchResponse,
  StructuredRequest,
  StructuredResponse,
} from './anthropic'

const isAnthropic = (model: string) => modelById(model).provider === 'anthropic'

export function testKey(apiKey: string, model: string): Promise<void> {
  return isAnthropic(model) ? anthropic.testKey(apiKey, model) : testCompatKey(apiKey, model)
}

export function generateFilters(req: anthropic.FilterRequest): Promise<anthropic.FilterResponse> {
  return isAnthropic(req.model) ? anthropic.generateFilters(req) : compatGenerateFilters(req)
}

export function scoreBatch(req: anthropic.ScoreBatchRequest): Promise<anthropic.ScoreBatchResponse> {
  return isAnthropic(req.model) ? anthropic.scoreBatch(req) : compatScoreBatch(req)
}

export function hqBatch(req: anthropic.HqBatchRequest): Promise<anthropic.HqBatchResponse> {
  return isAnthropic(req.model) ? anthropic.hqBatch(req) : compatHqBatch(req)
}

/** Every text model the provider offers for this key (Anthropic's list is built in). */
export function listModels(provider: Provider, apiKey: string): Promise<CustomModel[]> {
  if (provider === 'anthropic') return Promise.resolve([])
  return listCompatModels(provider, apiKey)
}

/** A request with its own prompt and JSON schema, on whichever provider the model belongs to. */
export function structuredCall(req: anthropic.StructuredRequest): Promise<anthropic.StructuredResponse> {
  return isAnthropic(req.model) ? anthropic.structured(req) : compatStructured(req)
}
