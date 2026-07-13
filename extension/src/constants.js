/** The vendor we register with VS Code; must match contributes.languageModelChatProviders. */
export const VENDOR = 'deepvariance';

/** A gateway-side alias. The underlying id (Qwen/Qwen3-VL-30B-A3B-Thinking) 404s. */
export const MODEL_ID = 'qwen-coder';

/**
 * The gateway currently serves Qwen/Qwen3.5-27B-FP8 behind the `qwen-coder` alias. The real id
 * works too, but the alias survives the gateway swapping the model underneath it.
 */
export const MODEL_NAME = 'Qwen3.5 27B';
export const MODEL_FAMILY = 'qwen3.5';

/** Reported by the gateway itself: max_model_len on GET /v1/models. */
export const CONTEXT_WINDOW = 131072;
export const MAX_OUTPUT_TOKENS = 8192;
