/** Local MT runtime locations. Everything under `.local-mt/` is git-ignored (binaries and model weights). */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LOCAL_MT_DIR = path.join(ROOT, '.local-mt');
export const LLAMA_DIR = path.join(LOCAL_MT_DIR, 'llama');
export const MODELS_DIR = path.join(LOCAL_MT_DIR, 'models');

/** Google Gemma 4 E2B instruction model, GGUF build by Unsloth (Apache-2.0). */
export const MODEL_REPO = 'unsloth/gemma-4-E2B-it-GGUF';
export const DEFAULT_QUANT = 'Q4_K_M';

export const modelFile = (quant = DEFAULT_QUANT) => path.join(MODELS_DIR, `gemma-4-E2B-it-${quant}.gguf`);

/** Model id the bridge reports in /v1/models, for example `gemma-4-e2b-q4_k_m`. */
export const modelId = (quant = DEFAULT_QUANT) => `gemma-4-e2b-${quant}`.toLowerCase();

/**
 * Uncommon loopback ports (below the Windows ephemeral range 49152+) so the stack does not clash with dev servers.
 * scripts/local-mt/tray.ps1 repeats these defaults; tests/unit/local-mt.test.js keeps them in sync.
 */
export const BRIDGE_PORT = 37813;
export const LLAMA_PORT = 37814;
