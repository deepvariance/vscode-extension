/**
 * The one definition of the model. Both the CLI and the extension read it — the extension
 * bundles this file via esbuild, so there is no second copy to drift.
 */

/**
 * The exact model id the gateway serves (GET /v1/models). There is NO stable alias: the gateway
 * used to accept `qwen-coder`, but it removed that alias when it swapped 3.5 → 3.6, so only the real
 * id works now. That means this must be updated and released whenever the gateway changes models —
 * a swap 404s the published extension until then. See SPEC.md §2.
 */
export const MODEL_ID = 'Qwen/Qwen3.6-27B-FP8';
export const MODEL_NAME = 'Qwen3.6 27B';
export const MODEL_FAMILY = 'qwen3.6';

/** Reported by the gateway itself: max_model_len on GET /v1/models. */
export const CONTEXT_WINDOW = 131072;
export const MAX_OUTPUT_TOKENS = 8192;

/** vLLM runs with --limit-mm-per-prompt {"image": 4}; more images than this fail at the gateway. */
export const MAX_IMAGES_PER_PROMPT = 4;
