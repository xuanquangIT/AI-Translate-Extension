/**
 * Single storage-initialization promise for this service-worker lifetime.
 * Every handler that reads settings must `await storageReady` first.
 */

import { initializeStorage } from '../storage/index.js';

export const storageReady = initializeStorage().catch((error) =>
  console.warn('[LingoFlux] storage initialization failed', error)
);
