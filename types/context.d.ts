/**
 * Context Management TypeScript Definitions
 * @module goodflows/types/context
 *
 * Types for context and session management:
 * - Session Context Manager
 * - Context Store (findings)
 * - Pattern Tracker
 * - Priority Queue
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
// Context Store (Findings)
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
