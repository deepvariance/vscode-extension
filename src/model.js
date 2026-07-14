/**
 * The one definition of the model. Both the CLI and the extension read it — the extension
 * bundles this file via esbuild, so there is no second copy to drift.
 */

/**
 * A gateway-side alias. The gateway currently routes it to Qwen/Qwen3.5-27B-FP8. The real id works
 * too, but the alias survives the gateway swapping the model underneath it — which is exactly what
 * broke @deepvariance/opencode, which pins a real id that now 404s.
 */
export const MODEL_ID = 'qwen-coder';
export const MODEL_NAME = 'Qwen3.5 27B';
export const MODEL_FAMILY = 'qwen3.5';

/** Reported by the gateway itself: max_model_len on GET /v1/models. */
export const CONTEXT_WINDOW = 131072;
export const MAX_OUTPUT_TOKENS = 8192;

/** vLLM runs with --limit-mm-per-prompt {"image": 4}; more images than this fail at the gateway. */
export const MAX_IMAGES_PER_PROMPT = 4;
