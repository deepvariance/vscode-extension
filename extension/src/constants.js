/** The vendor we register with VS Code; must match contributes.languageModelChatProviders. */
export const VENDOR = 'deepvariance';

// Bundled from the repo root, so the CLI and the extension cannot disagree about the model.
export { CONTEXT_WINDOW, MAX_IMAGES_PER_PROMPT, MAX_OUTPUT_TOKENS, MODEL_FAMILY, MODEL_ID, MODEL_NAME } from '../../src/model.js';
