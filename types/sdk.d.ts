/**
 * Claude Agent SDK TypeScript Definitions
 * @module goodflows/types/sdk
 *
 * Types for Claude Agent SDK integration:
 * - Agent definitions
 * - Hook interfaces
 * - MCP configurations
 * - SDK messages
 */

// ============================================================
// Agent Definitions
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

// ============================================================
// MCP Server Configurations
// ============================================================

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

// ============================================================
// Hook System
// ============================================================

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

// ============================================================
// Query Options
// ============================================================

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

// ============================================================
// SDK Messages
// ============================================================

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
