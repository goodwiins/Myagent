/**
 * MCP and SDK Adapter TypeScript Definitions
 * @module goodflows/types/mcp
 *
 * Types for MCP server integration and GoodFlows SDK adapter:
 * - Error classes
 * - MCP tool constants
 * - GoodFlows SDK integration
 * - Debug logging
 */

import type {
  SDKAgentDefinition,
  SDKHooksConfig,
  SDKHookCallbackMatcher,
  SDKMcpStdioServerConfig,
  SDKQueryOptions,
  SDKMessage,
} from './sdk';

import type {
  ContextStore,
  PatternTracker,
  SessionContextManager,
  PriorityQueue,
  QueueStats,
} from './context';

// ============================================================
// Errors
// ============================================================

export class GoodFlowsError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, code?: string, details?: Record<string, unknown>);

  toMcpResponse(): { content: Array<{ type: string; text: string }>; isError: boolean };
}

export class SessionNotFoundError extends GoodFlowsError {
  constructor(sessionId: string);
}

export class ValidationError extends GoodFlowsError {
  constructor(message: string, details?: Record<string, unknown>);
}

export class DuplicateFindingError extends GoodFlowsError {
  constructor(hash: string);
}

export class PlanNotFoundError extends GoodFlowsError {
  constructor(planId: string);
}

export class PatternNotFoundError extends GoodFlowsError {
  constructor(patternId: string);
}

// ============================================================
// MCP Tool Constants
// ============================================================

/**
 * Linear MCP tool names exposed by linear-mcp-server
 */
export const LINEAR_MCP_TOOLS: readonly [
  'linear__list_teams',
  'linear__create_issue',
  'linear__update_issue',
  'linear__get_issue',
  'linear__list_issue_labels',
  'linear__create_comment',
  'linear__search_issues'
];

/**
 * Serena MCP tool names exposed by serena-mcp-server
 */
export const SERENA_MCP_TOOLS: readonly [
  'serena__find_symbol',
  'serena__find_referencing_symbols',
  'serena__get_symbols_overview',
  'serena__replace_symbol_body',
  'serena__replace_content',
  'serena__read_file',
  'serena__read_memory',
  'serena__write_memory',
  'serena__search_for_pattern',
  'serena__list_dir'
];

// ============================================================
// GoodFlows SDK Adapter
// ============================================================

/**
 * GoodFlows agent definition (extends SDK agent with GoodFlows-specific fields)
 */
export interface GoodFlowsAgentDefinition extends SDKAgentDefinition {
  /** Model to use for this agent */
  model: 'sonnet' | 'opus' | 'haiku';
}

/**
 * GoodFlows agent registry - predefined agents for code review workflows
 */
export const GOODFLOWS_AGENTS: {
  'review-orchestrator': GoodFlowsAgentDefinition;
  'issue-creator': GoodFlowsAgentDefinition;
  'coderabbit-auto-fixer': GoodFlowsAgentDefinition;
};

/**
 * Options for creating GoodFlows hooks
 */
export interface GoodFlowsHooksOptions {
  /** Custom context store instance */
  contextStore?: ContextStore;
  /** Custom pattern tracker instance */
  patternTracker?: PatternTracker;
  /** Custom session manager instance */
  sessionManager?: SessionContextManager;
  /** Custom priority queue instance */
  priorityQueue?: PriorityQueue;
}

/**
 * GoodFlows hooks configuration (compatible with SDK hooks)
 */
export interface GoodFlowsHooksConfig extends SDKHooksConfig {
  PreToolUse: SDKHookCallbackMatcher[];
  PostToolUse: SDKHookCallbackMatcher[];
  SubagentStop: SDKHookCallbackMatcher[];
  SessionStart: SDKHookCallbackMatcher[];
  Stop: SDKHookCallbackMatcher[];
}

/**
 * Complete GoodFlows configuration for use with Claude Agent SDK
 */
export interface GoodFlowsConfig {
  /** GoodFlows agent definitions */
  agents: typeof GOODFLOWS_AGENTS;
  /** GoodFlows hooks for SDK integration */
  hooks: GoodFlowsHooksConfig;
  /** MCP server configurations for Linear and Serena */
  mcpServers: {
    linear: SDKMcpStdioServerConfig;
    serena?: SDKMcpStdioServerConfig;
  };
  /** Direct access to GoodFlows components */
  components: {
    contextStore: ContextStore;
    patternTracker: PatternTracker;
    sessionManager: SessionContextManager;
    priorityQueue: PriorityQueue;
  };
}

/**
 * Options for createGoodFlowsConfig
 */
export interface CreateGoodFlowsConfigOptions extends GoodFlowsHooksOptions {
  /** Enable Serena MCP server for code analysis */
  enableSerena?: boolean;
}

/**
 * Create GoodFlows hooks for SDK integration
 *
 * @example
 * ```typescript
 * import { query } from "@anthropic-ai/claude-agent-sdk";
 * import { createGoodFlowsHooks, GOODFLOWS_AGENTS } from "goodflows";
 *
 * for await (const message of query({
 *   prompt: "Run code review",
 *   options: {
 *     agents: GOODFLOWS_AGENTS,
 *     hooks: createGoodFlowsHooks()
 *   }
 * })) {
 *   console.log(message);
 * }
 * ```
 */
export function createGoodFlowsHooks(options?: GoodFlowsHooksOptions): GoodFlowsHooksConfig;

/**
 * Create a complete GoodFlows configuration for Claude Agent SDK
 *
 * @example
 * ```typescript
 * import { query } from "@anthropic-ai/claude-agent-sdk";
 * import { createGoodFlowsConfig } from "goodflows";
 *
 * const config = createGoodFlowsConfig();
 *
 * for await (const message of query({
 *   prompt: "Run full code review and create issues",
 *   options: {
 *     allowedTools: ["Read", "Glob", "Grep", "Bash", "Edit", "Task"],
 *     agents: config.agents,
 *     hooks: config.hooks,
 *     mcpServers: config.mcpServers
 *   }
 * })) {
 *   console.log(message);
 * }
 * ```
 */
export function createGoodFlowsConfig(options?: CreateGoodFlowsConfigOptions): GoodFlowsConfig;

/**
 * Options for runGoodFlows
 */
export interface RunGoodFlowsOptions extends CreateGoodFlowsConfigOptions {
  /** Additional SDK query options */
  sdkOptions?: Partial<SDKQueryOptions>;
  /** Progress callback for each message */
  onProgress?: (message: SDKMessage) => void;
}

/**
 * Result from runGoodFlows
 */
export interface RunGoodFlowsResult {
  /** All messages received during execution */
  messages: SDKMessage[];
  /** Session summary from GoodFlows */
  summary: Record<string, unknown>;
  /** Execution statistics */
  stats: {
    queue: QueueStats;
    session: Record<string, unknown>;
  };
}

/**
 * Quick start function for running GoodFlows with Claude Agent SDK
 *
 * @example
 * ```typescript
 * import { runGoodFlows } from "goodflows";
 *
 * const result = await runGoodFlows("Run full code review");
 * console.log(result.summary);
 * ```
 */
export function runGoodFlows(
  prompt: string,
  options?: RunGoodFlowsOptions
): Promise<RunGoodFlowsResult>;

// ============================================================
// Debug Logging
// ============================================================

export type DebugFunction = (message: string, ...args: unknown[]) => void;

export interface DebugNamespaces {
  session: DebugFunction;
  queue: DebugFunction;
  store: DebugFunction;
  pattern: DebugFunction;
  plan: DebugFunction;
  mcp: DebugFunction;
}

/**
 * Create a debug logger for a namespace
 * @param namespace - Debug namespace (e.g., 'goodflows:session')
 */
export function createDebug(namespace: string): DebugFunction;

/**
 * Check if any debug logging is enabled
 */
export function isDebugEnabled(): boolean;

/**
 * Pre-created debug loggers for common namespaces
 */
export const debug: DebugNamespaces;
