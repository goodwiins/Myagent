/**
 * GoodFlows TypeScript Definitions
 * @module goodflows
 *
 * Main entry point - re-exports all types from modular files for backward compatibility.
 *
 * Modular imports available:
 * - `goodflows/types/sdk` - Claude Agent SDK types
 * - `goodflows/types/context` - Session and context management types
 * - `goodflows/types/gsd` - GSD execution framework types
 * - `goodflows/types/mcp` - MCP integration and error types
 */

// ============================================================
// Re-export all types from modular files
// ============================================================

// SDK Types (Agent definitions, hooks, MCP configs, messages)
export type {
  SDKAgentDefinition,
  SDKPermissionMode,
  SDKSettingSource,
  SDKMcpStdioServerConfig,
  SDKMcpSSEServerConfig,
  SDKMcpHttpServerConfig,
  SDKMcpServerConfig,
  SDKHookEvent,
  SDKBaseHookInput,
  SDKPreToolUseHookInput,
  SDKPostToolUseHookInput,
  SDKSessionStartHookInput,
  SDKSubagentStopHookInput,
  SDKStopHookInput,
  SDKHookInput,
  SDKSyncHookOutput,
  SDKAsyncHookOutput,
  SDKHookOutput,
  SDKHookCallback,
  SDKHookCallbackMatcher,
  SDKHooksConfig,
  SDKQueryOptions,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKSystemMessage,
  SDKModelUsage,
  SDKResultMessageSuccess,
  SDKResultMessageError,
  SDKResultMessage,
  SDKMessage,
} from './sdk';

// Context Types (Session, Store, Patterns, Queue)
export type {
  Priority,
  TypeToPriority,
  ItemState,
  QueueMeta,
  QueueItem,
  QueueStats,
  PriorityQueueOptions,
  SessionState,
  SessionMetadata,
  SessionCheckpoint,
  SessionContextManagerOptions,
  Finding,
  QueryFilters,
  SimilarityOptions,
  ContextStoreOptions,
  Pattern,
  PatternTrackerOptions,
  PatternRecommendation,
} from './context';

export {
  PRIORITY,
  TYPE_TO_PRIORITY,
  ITEM_STATE,
  SESSION_STATES,
  PriorityQueue,
  SessionContextManager,
  ContextStore,
  PatternTracker,
  createPriorityQueue,
  sortByPriority,
  filterByPriority,
  groupByPriority,
} from './context';

// GSD Types (Context files, Plans, Agent registry)
export type {
  ContextFiles,
  SizeLimits,
  ContextFileManagerOptions,
  PlanState,
  SubtaskState,
  Subtask,
  Plan,
  PlanExecutorOptions,
  AgentSchema,
  PriorityLevels,
  LabelMapping,
  TitlePrefixes,
  RegistryAgentDefinition,
} from './gsd';

export {
  CONTEXT_FILES,
  SIZE_LIMITS,
  ContextFileManager,
  PLAN_STATES,
  SUBTASK_STATES,
  PlanExecutor,
  AGENT_SCHEMAS,
  PRIORITY_LEVELS,
  LABEL_MAPPING,
  TITLE_PREFIXES,
  AgentRegistry,
  createAgentRegistry,
} from './gsd';

// MCP Types (Errors, MCP tools, SDK adapter, Debug)
export type {
  GoodFlowsAgentDefinition,
  GoodFlowsHooksOptions,
  GoodFlowsHooksConfig,
  GoodFlowsConfig,
  CreateGoodFlowsConfigOptions,
  RunGoodFlowsOptions,
  RunGoodFlowsResult,
  DebugFunction,
  DebugNamespaces,
} from './mcp';

export {
  GoodFlowsError,
  SessionNotFoundError,
  ValidationError,
  DuplicateFindingError,
  PlanNotFoundError,
  PatternNotFoundError,
  LINEAR_MCP_TOOLS,
  SERENA_MCP_TOOLS,
  GOODFLOWS_AGENTS,
  createGoodFlowsHooks,
  createGoodFlowsConfig,
  runGoodFlows,
  createDebug,
  isDebugEnabled,
  debug,
} from './mcp';
