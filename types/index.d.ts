/**
 * GoodFlows TypeScript Definitions
 * @module goodflows
 */

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

export interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  color?: string;
  tools?: string[];
  triggers?: string[];
}

export const GOODFLOWS_AGENTS: AgentDefinition[];

export class AgentRegistry {
  constructor();

  register(agent: AgentDefinition): void;
  get(name: string): AgentDefinition | undefined;
  getAll(): AgentDefinition[];
  findByTrigger(text: string): AgentDefinition | null;
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
// SDK Adapter
// ============================================================

export interface GoodFlowsHooksConfig {
  PreToolUse: Array<{ matcher: string; hooks: Array<(...args: unknown[]) => Promise<unknown>> }>;
  PostToolUse: Array<{ hooks: Array<(...args: unknown[]) => Promise<unknown>> }>;
  Stop: Array<{ hooks: Array<(...args: unknown[]) => Promise<unknown>> }>;
}

export interface GoodFlowsConfigOptions {
  contextStore?: ContextStore;
  patternTracker?: PatternTracker;
  sessionManager?: SessionContextManager;
  priorityQueue?: PriorityQueue;
}

export function createGoodFlowsHooks(options?: GoodFlowsConfigOptions): GoodFlowsHooksConfig;
export function createGoodFlowsConfig(options?: GoodFlowsConfigOptions): GoodFlowsHooksConfig;
export function runWithGoodFlows(prompt: string, options?: GoodFlowsConfigOptions): Promise<unknown>;

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
