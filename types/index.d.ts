/**
 * GoodFlows TypeScript Definitions
 * @module goodflows
 *
 * Includes comprehensive type definitions for:
 * - GoodFlows core components (Context Store, Priority Queue, Session Manager, etc.)
 * - Claude Agent SDK integration types
 * - MCP server configurations
 * - Hook system types
 */

// ============================================================
// Claude Agent SDK Types (Compatible with @anthropic-ai/claude-agent-sdk)
// ============================================================

/**
 * Agent definition for programmatic subagent configuration.
 * Used with the `agents` option in query().
 */
export interface SDKAgentDefinition {
  /** Natural language description of when to use this agent */
  description: string;
  /** Array of allowed tool names. If omitted, inherits all tools */
  tools?: string[];
  /** The agent's system prompt */
  prompt: string;
  /** Model override for this agent */
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
}

/**
 * Permission modes for the SDK session
 */
export type SDKPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/**
 * Setting sources for filesystem configuration
 */
export type SDKSettingSource = 'user' | 'project' | 'local';

/**
 * MCP server configuration - stdio transport
 */
export interface SDKMcpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * MCP server configuration - SSE transport
 */
export interface SDKMcpSSEServerConfig {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

/**
 * MCP server configuration - HTTP transport
 */
export interface SDKMcpHttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

/**
 * Union of all MCP server configurations
 */
export type SDKMcpServerConfig =
  | SDKMcpStdioServerConfig
  | SDKMcpSSEServerConfig
  | SDKMcpHttpServerConfig;

/**
 * Hook event types supported by the SDK
 */
export type SDKHookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest';

/**
 * Base hook input that all hook types extend
 */
export interface SDKBaseHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
  hook_event_name: SDKHookEvent;
}

/**
 * PreToolUse hook input
 */
export interface SDKPreToolUseHookInput extends SDKBaseHookInput {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: unknown;
}

/**
 * PostToolUse hook input
 */
export interface SDKPostToolUseHookInput extends SDKBaseHookInput {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
}

/**
 * SessionStart hook input
 */
export interface SDKSessionStartHookInput extends SDKBaseHookInput {
  hook_event_name: 'SessionStart';
  source: 'startup' | 'resume' | 'clear' | 'compact';
}

/**
 * SubagentStop hook input
 */
export interface SDKSubagentStopHookInput extends SDKBaseHookInput {
  hook_event_name: 'SubagentStop';
  stop_hook_active: boolean;
}

/**
 * Stop hook input
 */
export interface SDKStopHookInput extends SDKBaseHookInput {
  hook_event_name: 'Stop';
  stop_hook_active: boolean;
}

/**
 * Union of all hook input types
 */
export type SDKHookInput =
  | SDKPreToolUseHookInput
  | SDKPostToolUseHookInput
  | SDKSessionStartHookInput
  | SDKSubagentStopHookInput
  | SDKStopHookInput
  | SDKBaseHookInput;

/**
 * Synchronous hook output
 */
export interface SDKSyncHookOutput {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: 'approve' | 'block';
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: SDKHookEvent;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
  };
}

/**
 * Async hook output
 */
export interface SDKAsyncHookOutput {
  async: true;
  asyncTimeout?: number;
}

/**
 * Union of hook output types
 */
export type SDKHookOutput = SDKSyncHookOutput | SDKAsyncHookOutput;

/**
 * Hook callback function signature
 */
export type SDKHookCallback = (
  input: SDKHookInput,
  toolUseId: string | undefined,
  options: { signal: AbortSignal }
) => Promise<SDKHookOutput>;

/**
 * Hook configuration with matcher
 */
export interface SDKHookCallbackMatcher {
  /** Regex pattern to match tool names (e.g., 'Edit|Write') */
  matcher?: string;
  /** Array of hook callbacks to execute */
  hooks: SDKHookCallback[];
}

/**
 * Complete hooks configuration object
 */
export type SDKHooksConfig = Partial<Record<SDKHookEvent, SDKHookCallbackMatcher[]>>;

/**
 * SDK query options
 */
export interface SDKQueryOptions {
  /** Controller for cancelling operations */
  abortController?: AbortController;
  /** Additional directories Claude can access */
  additionalDirectories?: string[];
  /** Programmatically define subagents */
  agents?: Record<string, SDKAgentDefinition>;
  /** Enable bypassing permissions (use with permissionMode: 'bypassPermissions') */
  allowDangerouslySkipPermissions?: boolean;
  /** List of allowed tool names */
  allowedTools?: string[];
  /** Continue the most recent conversation */
  continue?: boolean;
  /** Current working directory */
  cwd?: string;
  /** List of disallowed tool names */
  disallowedTools?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Hook callbacks for events */
  hooks?: SDKHooksConfig;
  /** Include partial message events (for streaming) */
  includePartialMessages?: boolean;
  /** Maximum budget in USD */
  maxBudgetUsd?: number;
  /** Maximum tokens for thinking process */
  maxThinkingTokens?: number;
  /** Maximum conversation turns */
  maxTurns?: number;
  /** MCP server configurations */
  mcpServers?: Record<string, SDKMcpServerConfig>;
  /** Claude model to use */
  model?: string;
  /** Permission mode for the session */
  permissionMode?: SDKPermissionMode;
  /** Session ID to resume */
  resume?: string;
  /** Control which filesystem settings to load */
  settingSources?: SDKSettingSource[];
  /** System prompt configuration */
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
}

/**
 * SDK message types - Assistant message
 */
export interface SDKAssistantMessage {
  type: 'assistant';
  uuid: string;
  session_id: string;
  message: {
    role: 'assistant';
    content: Array<{
      type: 'text' | 'tool_use';
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
  };
  parent_tool_use_id: string | null;
}

/**
 * SDK message types - User message
 */
export interface SDKUserMessage {
  type: 'user';
  uuid?: string;
  session_id: string;
  message: {
    role: 'user';
    content: string | Array<{ type: string; [key: string]: unknown }>;
  };
  parent_tool_use_id: string | null;
}

/**
 * SDK message types - System init message
 */
export interface SDKSystemMessage {
  type: 'system';
  subtype: 'init';
  uuid: string;
  session_id: string;
  cwd: string;
  tools: string[];
  mcp_servers: Array<{ name: string; status: string }>;
  model: string;
  permissionMode: SDKPermissionMode;
}

/**
 * Model usage statistics
 */
export interface SDKModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
}

/**
 * SDK message types - Result message (success)
 */
export interface SDKResultMessageSuccess {
  type: 'result';
  subtype: 'success';
  uuid: string;
  session_id: string;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  modelUsage: Record<string, SDKModelUsage>;
}

/**
 * SDK message types - Result message (error)
 */
export interface SDKResultMessageError {
  type: 'result';
  subtype: 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd';
  uuid: string;
  session_id: string;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  modelUsage: Record<string, SDKModelUsage>;
  errors: string[];
}

/**
 * Union of SDK result message types
 */
export type SDKResultMessage = SDKResultMessageSuccess | SDKResultMessageError;

/**
 * Union of all SDK message types
 */
export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKSystemMessage
  | SDKResultMessage;

// ============================================================
// Priority Queue
// ============================================================

export interface Priority {
  URGENT: 1;
  HIGH: 2;
  NORMAL: 3;
  LOW: 4;
}

export const PRIORITY: Priority;

export interface TypeToPriority {
  critical_security: 1;
  potential_issue: 2;
  refactor_suggestion: 3;
  performance: 3;
  documentation: 4;
  [key: string]: number;
}

export const TYPE_TO_PRIORITY: TypeToPriority;

export interface ItemState {
  PENDING: 'pending';
  PROCESSING: 'processing';
  COMPLETED: 'completed';
  FAILED: 'failed';
  SKIPPED: 'skipped';
}

export const ITEM_STATE: ItemState;

export interface QueueMeta {
  id: string;
  priority: number;
  enqueuedAt: string;
  state: string;
  attempts: number;
  completedAt?: string;
  failedAt?: string;
  skippedAt?: string;
  evictedAt?: string;
  result?: unknown;
  lastError?: string;
  skipReason?: string;
  evictReason?: string;
}

export interface QueueItem<T = unknown> {
  _queueMeta: QueueMeta;
  [key: string]: unknown;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  skipped: number;
  evicted: number;
  maxSize: number;
  total: number;
  byPriority: {
    urgent: number;
    high: number;
    normal: number;
    low: number;
  };
}

export interface PriorityQueueOptions {
  throttleMs?: number;
  maxRetries?: number;
  batchSize?: number;
  priorityThreshold?: number;
  maxSize?: number;
  sessionManager?: SessionContextManager;
  onProcess?: (item: QueueItem) => Promise<unknown>;
  onComplete?: () => void;
  onError?: (error: Error, item: QueueItem) => void;
}

export class PriorityQueue<T = unknown> {
  items: QueueItem<T>[];
  processed: QueueItem<T>[];
  failed: QueueItem<T>[];
  skipped: QueueItem<T>[];
  evicted: QueueItem<T>[];
  priorityThreshold: number;
  maxRetries: number;
  maxSize: number;
  currentItem: QueueItem<T> | null;

  constructor(options?: PriorityQueueOptions);
  
  getPriority(item: T): number;
  enqueue(item: T): boolean;
  enqueueAll(items: T[]): { added: number; skipped: number };
  dequeue(): QueueItem<T> | null;
  peek(): QueueItem<T> | null;
  isEmpty(): boolean;
  size(): number;
  markCompleted(result?: unknown): void;
  markFailed(error: Error | string): void;
  markSkipped(reason: string): void;
  processAll(handler?: (item: QueueItem<T>) => Promise<unknown>): Promise<Array<{ item: QueueItem<T>; status: string; result?: unknown; error?: string }>>;
  pause(): void;
  resume(): void;
  clear(): void;
  getByPriority(): Record<number, QueueItem<T>[]>;
  getStats(): QueueStats;
  getItems(state?: string): QueueItem<T>[] | Record<string, QueueItem<T>[]>;
  retryFailed(): number;
}

export function createPriorityQueue<T = unknown>(options?: PriorityQueueOptions): PriorityQueue<T>;
export function sortByPriority<T>(findings: T[]): T[];
export function filterByPriority<T>(findings: T[], threshold?: number): T[];
export function groupByPriority<T>(findings: T[]): { urgent: T[]; high: T[]; normal: T[]; low: T[] };

// ============================================================
// Session Context Manager
// ============================================================

export interface SessionState {
  ACTIVE: 'active';
  PAUSED: 'paused';
  COMPLETED: 'completed';
  FAILED: 'failed';
}

export const SESSION_STATES: SessionState;

export interface SessionMetadata {
  trigger?: string;
  branch?: string;
  project?: string;
  [key: string]: unknown;
}

export interface SessionCheckpoint {
  id: string;
  name: string;
  timestamp: string;
  context: Record<string, unknown>;
}

export interface SessionContextManagerOptions {
  basePath?: string;
  autoSave?: boolean;
  saveInterval?: number;
}

export class SessionContextManager {
  sessionId: string | null;
  context: Record<string, unknown>;
  checkpoints: SessionCheckpoint[];

  constructor(options?: SessionContextManagerOptions);

  start(metadata?: SessionMetadata): string;
  static resume(sessionId: string): SessionContextManager | null;
  get(path: string): unknown;
  set(path: string, value: unknown): void;
  getAll(): Record<string, unknown>;
  checkpoint(name: string): string;
  rollback(checkpointId: string): boolean;
  addEvent(type: string, data?: Record<string, unknown>): void;
  getSummary(): Record<string, unknown>;
  complete(summary?: Record<string, unknown>): void;
  fail(error: Error | string): void;
  destroy(): void;
}

// ============================================================
// Context Store
// ============================================================

export interface Finding {
  file: string;
  lines?: string;
  type: string;
  description: string;
  severity?: string;
  proposedFix?: string;
  status?: string;
  _hash?: string;
  _timestamp?: string;
}

export interface QueryFilters {
  type?: string;
  file?: string;
  status?: string;
  limit?: number;
  since?: string;
}

export interface SimilarityOptions {
  threshold?: number;
  file?: string;
  type?: string;
}

export interface ContextStoreOptions {
  basePath?: string;
  enableIndex?: boolean;
}

export class ContextStore {
  constructor(options?: ContextStoreOptions);

  addFinding(finding: Finding): { added: boolean; hash: string; duplicate: boolean };
  getFinding(hash: string): Finding | null;
  updateFinding(hash: string, metadata: Partial<Finding>): boolean;
  query(filters?: QueryFilters): Finding[];
  getAll(options?: { limit?: number }): Finding[];
  findSimilar(description: string, options?: SimilarityOptions): Finding[];
  exportToMarkdown(options?: { type?: string; status?: string }): string;
  getStats(): { total: number; byType: Record<string, number>; byStatus: Record<string, number> };
}

// ============================================================
// Pattern Tracker
// ============================================================

export interface Pattern {
  patternId: string;
  description: string;
  type: string;
  template?: string;
  confidence: number;
  successCount?: number;
  failureCount?: number;
}

export interface PatternTrackerOptions {
  basePath?: string;
  includeBuiltins?: boolean;
}

export interface PatternRecommendation {
  pattern: Pattern;
  confidence: number;
  reason: string;
}

export class PatternTracker {
  constructor(options?: PatternTrackerOptions);

  recommend(finding: Finding, options?: { minConfidence?: number }): PatternRecommendation[];
  recommend(type: string, description?: string, options?: { minConfidence?: number }): PatternRecommendation[];
  recordResult(patternId: string, success: boolean, context?: Record<string, unknown>): void;
  recordSuccess(patternId: string, context?: Record<string, unknown>): void;
  recordFailure(patternId: string, context?: Record<string, unknown>): void;
  addPattern(pattern: Partial<Pattern>): string;
  getPatterns(): Pattern[];
}

// ============================================================
// Context Files
// ============================================================

export interface ContextFiles {
  PROJECT: 'PROJECT';
  ROADMAP: 'ROADMAP';
  STATE: 'STATE';
  PLAN: 'PLAN';
  SUMMARY: 'SUMMARY';
  ISSUES: 'ISSUES';
}

export const CONTEXT_FILES: ContextFiles;

export interface SizeLimits {
  PROJECT: number;
  ROADMAP: number;
  STATE: number;
  PLAN: number;
  SUMMARY: number;
  ISSUES: number;
}

export const SIZE_LIMITS: SizeLimits;

export interface ContextFileManagerOptions {
  basePath?: string;
}

export class ContextFileManager {
  constructor(options?: ContextFileManagerOptions);

  read(file: keyof ContextFiles): string | null;
  write(file: keyof ContextFiles, content: string, options?: { allowOversize?: boolean }): boolean;
  getStatus(): Record<string, { exists: boolean; size: number; limit: number; oversize: boolean }>;
  init(options?: { force?: boolean }): void;
}

// ============================================================
// Plan Executor
// ============================================================

export interface PlanState {
  PENDING: 'pending';
  RUNNING: 'running';
  COMPLETED: 'completed';
  PARTIAL: 'partial';
  FAILED: 'failed';
  CANCELLED: 'cancelled';
}

export const PLAN_STATES: PlanState;

export interface SubtaskState {
  PENDING: 'pending';
  RUNNING: 'running';
  COMPLETED: 'completed';
  FAILED: 'failed';
  SKIPPED: 'skipped';
  BLOCKED: 'blocked';
}

export const SUBTASK_STATES: SubtaskState;

export interface Subtask {
  id: string;
  description: string;
  agentType?: string;
  priority: number;
  status: string;
  dependencies: string[];
  context?: Record<string, unknown>;
}

export interface Plan {
  id: string;
  task: string;
  status: string;
  subtasks: Subtask[];
  results: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PlanExecutorOptions {
  basePath?: string;
}

export class PlanExecutor {
  constructor(options?: PlanExecutorOptions);

  create(task: string, options?: { sessionId?: string; maxSubtasks?: number; context?: Record<string, unknown> }): Plan;
  execute(planId: string, options?: { async?: boolean }): Promise<unknown>;
  getStatus(planId: string): { status: string; progress: Record<string, number>; subtasks: Subtask[] } | null;
  getSubtaskResult(planId: string, subtaskId: string): unknown;
  cancel(planId: string, reason?: string): boolean;
}

// ============================================================
// Agent Registry
// ============================================================

export interface AgentSchema {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export const AGENT_SCHEMAS: Record<string, AgentSchema>;

export interface PriorityLevels {
  CRITICAL: 1;
  HIGH: 2;
  MEDIUM: 3;
  LOW: 4;
}

export const PRIORITY_LEVELS: PriorityLevels;

export interface LabelMapping {
  critical_security: string;
  potential_issue: string;
  refactor_suggestion: string;
  performance: string;
  documentation: string;
}

export const LABEL_MAPPING: LabelMapping;

export interface TitlePrefixes {
  critical_security: string;
  potential_issue: string;
  refactor_suggestion: string;
  performance: string;
  documentation: string;
}

export const TITLE_PREFIXES: TitlePrefixes;

/**
 * Agent definition for the Agent Registry (internal GoodFlows format)
 * Different from SDKAgentDefinition - includes additional metadata fields
 */
export interface RegistryAgentDefinition {
  /** Agent name/identifier */
  name: string;
  /** Description of the agent's purpose */
  description: string;
  /** Model to use */
  model?: 'sonnet' | 'opus' | 'haiku';
  /** Display color for UI */
  color?: string;
  /** List of tool names the agent can use */
  tools?: string[];
  /** Trigger phrases that activate this agent */
  triggers?: string[];
}

export class AgentRegistry {
  constructor();

  register(agent: RegistryAgentDefinition): void;
  get(name: string): RegistryAgentDefinition | undefined;
  getAll(): RegistryAgentDefinition[];
  findByTrigger(text: string): RegistryAgentDefinition | null;
}

export function createAgentRegistry(): AgentRegistry;

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
// SDK Adapter (GoodFlows + Claude Agent SDK Integration)
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
