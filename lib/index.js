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

import { ContextStore } from './context-store.js';
import { PatternTracker } from './pattern-tracker.js';
import {
  generateTrigrams,
  trigramSimilarity,
  textSimilarity,
  LRUCache,
  InvertedIndex,
  BloomFilter,
  findSimilar,
} from './context-index.js';
import {
  AgentRegistry,
  createAgentRegistry,
  createAgentRequest,
  AGENT_SCHEMAS,
  PRIORITY_LEVELS,
  LABEL_MAPPING,
  TITLE_PREFIXES,
} from './agent-registry.js';
import {
  SessionContextManager,
  createSessionContext,
  SESSION_STATES,
} from './session-context.js';
import {
  PriorityQueue,
  createPriorityQueue,
  sortByPriority,
  filterByPriority,
  groupByPriority,
  PRIORITY,
  TYPE_TO_PRIORITY,
  ITEM_STATE,
} from './priority-queue.js';
import {
  GOODFLOWS_AGENTS,
  LINEAR_MCP_TOOLS,
  createGoodFlowsHooks,
  createGoodFlowsConfig,
  runGoodFlows,
} from './sdk-adapter.js';

// Re-export all
export {
  // Context storage
  ContextStore,
  PatternTracker,
  generateTrigrams,
  trigramSimilarity,
  textSimilarity,
  LRUCache,
  InvertedIndex,
  BloomFilter,
  findSimilar,
  // Agent registry
  AgentRegistry,
  createAgentRegistry,
  createAgentRequest,
  AGENT_SCHEMAS,
  PRIORITY_LEVELS,
  LABEL_MAPPING,
  TITLE_PREFIXES,
  // Session context
  SessionContextManager,
  createSessionContext,
  SESSION_STATES,
  // Priority queue
  PriorityQueue,
  createPriorityQueue,
  sortByPriority,
  filterByPriority,
  groupByPriority,
  PRIORITY,
  TYPE_TO_PRIORITY,
  ITEM_STATE,
  // SDK adapter (Claude Agent SDK integration)
  GOODFLOWS_AGENTS,
  LINEAR_MCP_TOOLS,
  createGoodFlowsHooks,
  createGoodFlowsConfig,
  runGoodFlows,
};

/**
 * Create a pre-configured context store with default settings
 * @param {object} options
 * @returns {ContextStore}
 */
export function createContextStore(options = {}) {
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
  return new PatternTracker({
    basePath: options.basePath || '.goodflows/context/patterns',
    includeBuiltins: options.includeBuiltins !== false,
  });
}

export default {
  // Context storage
  ContextStore,
  PatternTracker,
  createContextStore,
  createPatternTracker,
  // Agent registry
  AgentRegistry,
  createAgentRegistry,
  createAgentRequest,
  AGENT_SCHEMAS,
  PRIORITY_LEVELS,
  LABEL_MAPPING,
  TITLE_PREFIXES,
  // Session context
  SessionContextManager,
  createSessionContext,
  SESSION_STATES,
  // Priority queue
  PriorityQueue,
  createPriorityQueue,
  sortByPriority,
  filterByPriority,
  groupByPriority,
  PRIORITY,
  TYPE_TO_PRIORITY,
  ITEM_STATE,
  // SDK adapter (Claude Agent SDK integration)
  GOODFLOWS_AGENTS,
  LINEAR_MCP_TOOLS,
  createGoodFlowsHooks,
  createGoodFlowsConfig,
  runGoodFlows,
};
