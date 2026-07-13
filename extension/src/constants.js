/** The vendor we register with VS Code; must match contributes.languageModelChatProviders. */
export const VENDOR = 'deepvariance';

/** A gateway-side alias. The underlying id (Qwen/Qwen3-VL-30B-A3B-Thinking) 404s. */
export const MODEL_ID = 'qwen-coder';
export const MODEL_NAME = 'Qwen3-VL Coder';

/** Reported by the gateway itself: max_model_len on GET /v1/models. */
export const CONTEXT_WINDOW = 131072;
export const MAX_OUTPUT_TOKENS = 8192;
