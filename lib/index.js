/**
 * GoodFlows Context Storage Library
 *
 * Enhanced memory storage for multi-agent AI systems
 *
 * Features:
 * - JSONL-based partitioned storage
 * - Content-hash deduplication
 * - Trigram-based similarity search
 * - Pattern tracking with confidence scores
 * - Bloom filters for fast duplicate detection
 * - Inverted index for keyword search
 *
 * @module goodflows/lib
 */

export { ContextStore } from './context-store.js';
export { PatternTracker } from './pattern-tracker.js';
export {
  generateTrigrams,
  trigramSimilarity,
  textSimilarity,
  LRUCache,
  InvertedIndex,
  BloomFilter,
  findSimilar,
} from './context-index.js';

/**
 * Create a pre-configured context store with default settings
 * @param {object} options
 * @returns {ContextStore}
 */
export function createContextStore(options = {}) {
  const { ContextStore } = require('./context-store.js');
  return new ContextStore({
    basePath: options.basePath || '.goodflows/context',
    enableIndex: options.enableIndex !== false,
    ttl: {
      findings: options.ttl?.findings || '30d',
      patterns: options.ttl?.patterns || 'forever',
      sessions: options.ttl?.sessions || '7d',
    },
  });
}

/**
 * Create a pre-configured pattern tracker
 * @param {object} options
 * @returns {PatternTracker}
 */
export function createPatternTracker(options = {}) {
  const { PatternTracker } = require('./pattern-tracker.js');
  return new PatternTracker({
    basePath: options.basePath || '.goodflows/context/patterns',
    includeBuiltins: options.includeBuiltins !== false,
  });
}

export default {
  ContextStore,
  PatternTracker,
  createContextStore,
  createPatternTracker,
};
