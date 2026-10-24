/**
 * Browser entry point of the AI boundary: build a bounded sample, send it to `/api/interpret`,
 * and verify the proposal against the full workbook. The OpenRouter provider is server-only and
 * deliberately not exported here.
 */
export { buildInterpretationRequest } from './request';
export { verifyInterpretation } from './verify';
export { createHttpInterpreter, getAiAvailability, InterpretationError } from './client';
export { MockInterpreter, mockInterpretation, adversarialTables } from './mock';
export { AI_LIMITS, AI_MIN_CONFIDENCE, type AiAvailability } from './schema';
