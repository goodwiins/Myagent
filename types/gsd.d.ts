/**
 * GSD (Get Shit Done) TypeScript Definitions
 * @module goodflows/types/gsd
 *
 * Types for GSD execution framework:
 * - Context Files (PROJECT, ROADMAP, STATE, etc.)
 * - Plan Executor
 * - Agent Registry
 * - Task and Phase types
 */

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
