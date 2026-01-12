/**
 * GoodFlows Plan Executor
 *
 * Orchestrates plan creation, subtask execution, and result aggregation.
 * Prevents context degradation by limiting each plan to max 3 subtasks,
 * each executed in a fresh subagent with full context window.
 *
 * @module goodflows/lib/plan-executor
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PRIORITY } from './priority-queue.js';
import { splitTask, detectComplexity } from './task-splitter.js';

/**
 * Plan states
 */
export const PLAN_STATES = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/**
 * Subtask states
 */
export const SUBTASK_STATES = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  SKIPPED: 'skipped',
};

/**
 * Maximum subtasks per plan (prevents context degradation)
 */
export const MAX_SUBTASKS = 3;

/**
 * PlanExecutor - Orchestrates execution of plans with fresh-context subtasks
 *
 * ## How It Works
 *
 * The Plan Executor prevents context degradation by splitting complex tasks
 * into max 3 subtasks, each executed in a fresh subagent context:
 *
 * ```
 * Complex Task → [Subtask 1] [Subtask 2] [Subtask 3] (max 3)
 *                    ↓           ↓           ↓
 *              [Fresh 200k] [Fresh 200k] [Fresh 200k]
 *                    └───────────┴───────────┘
 *                              ↓
 *                    Session Context (shared)
 * ```
 *
 * ## Key Benefits
 *
 * - **No context degradation** - Each subtask gets fresh 200k tokens
 * - **Walk away capability** - Async execution with disk persistence
 * - **Priority-first processing** - Critical tasks before minor ones
 * - **Failure isolation** - One subtask failure doesn't kill the plan
 *
 * ## Usage Example
 *
 * ```javascript
 * const executor = new PlanExecutor();
 *
 * // Create plan from complex task
 * const plan = await executor.createPlan(
 *   'Review codebase, fix security issues, add tests',
 *   sessionId
 * );
 *
 * // Execute plan (async)
 * const result = await executor.execute(plan.id, { async: true });
 *
 * // Monitor progress
 * const status = executor.getStatus(plan.id);
 * ```
 */
export class PlanExecutor {
  constructor(options = {}) {
    this.basePath = options.basePath || '.goodflows/context/plans';
    this.sessionManager = options.sessionManager || null;
    this.plans = new Map(); // In-memory cache
    this.runningExecutions = new Map(); // Track async executions

    this._ensureDir();
  }

  /**
   * Generate a unique plan ID
   */
  _generatePlanId() {
    const timestamp = Date.now();
    const random = createHash('sha256')
      .update(Math.random().toString() + timestamp)
      .digest('hex')
      .slice(0, 8);
    return `plan_${timestamp}_${random}`;
  }

  /**
   * Generate a subtask ID
   */
  _generateSubtaskId(sequence) {
    const random = createHash('sha256')
      .update(Math.random().toString() + Date.now())
      .digest('hex')
      .slice(0, 6);
    return `st_${sequence}_${random}`;
  }

  /**
   * Get the file path for a plan
   */
  _getPlanPath(planId) {
    return join(this.basePath, `${planId}.json`);
  }

  /**
   * Ensure the plans directory exists
   */
  _ensureDir() {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Save a plan to disk
   */
  _save(plan) {
    this._ensureDir();
    const path = this._getPlanPath(plan.id);
    writeFileSync(path, JSON.stringify(plan, null, 2));
    this.plans.set(plan.id, plan);
  }

  /**
   * Load a plan from disk
   */
  _load(planId) {
    // Check in-memory cache first
    if (this.plans.has(planId)) {
      return this.plans.get(planId);
    }

    const path = this._getPlanPath(planId);
    if (!existsSync(path)) {
      return null;
    }

    const plan = JSON.parse(readFileSync(path, 'utf-8'));
    this.plans.set(planId, plan);
    return plan;
  }

  /**
   * Create a plan from a complex task
   *
   * @param {string} task - Task description
   * @param {string} sessionId - Parent session ID
   * @param {object} options - Options
   * @param {number} options.maxSubtasks - Max subtasks (default: 3)
   * @param {number} options.priorityThreshold - Priority threshold (default: 4)
   * @returns {object} Created plan
   */
  async createPlan(task, sessionId, options = {}) {
    const maxSubtasks = Math.min(options.maxSubtasks || MAX_SUBTASKS, MAX_SUBTASKS);
    const priorityThreshold = options.priorityThreshold || PRIORITY.LOW;

    // Detect task complexity
    const complexity = detectComplexity(task);

    // Split task into subtasks
    const splitResult = splitTask(task, {
      maxSubtasks,
      priorityThreshold,
      context: options.context || {},
    });

    // Create plan structure
    const planId = this._generatePlanId();
    const plan = {
      id: planId,
      sessionId,
      status: PLAN_STATES.PENDING,
      priority: this._getHighestPriority(splitResult.subtasks),

      originalTask: {
        description: task,
        complexity,
        context: options.context || {},
      },

      subtasks: splitResult.subtasks.map((st, index) => ({
        id: this._generateSubtaskId(index + 1),
        planId,
        sequence: index + 1,
        priority: st.priority || PRIORITY.NORMAL,
        status: SUBTASK_STATES.PENDING,
        description: st.description,
        agentType: st.agentType || 'general',
        input: st.input || {},
        dependencies: st.dependencies || [],
        dependencyMode: st.dependencyMode || 'all',
        context: {
          sessionId,
          parentPlanId: planId,
          priorResults: {},
          freshTokenBudget: 200000,
        },
        retry: {
          maxAttempts: st.maxRetries || 3,
          currentAttempt: 0,
          backoffMs: 1000,
        },
        startedAt: null,
        completedAt: null,
        durationMs: null,
      })),

      execution: {
        startedAt: null,
        completedAt: null,
        currentSubtaskId: null,
        checkpoints: [],
      },

      results: {},

      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save plan
    this._save(plan);

    // Update session context
    if (this.sessionManager) {
      this.sessionManager.set('plans.active', planId);
      this.sessionManager.addEvent('plan_created', {
        planId,
        subtaskCount: plan.subtasks.length,
        complexity,
      });
    }

    return plan;
  }

  /**
   * Get the highest priority from subtasks
   */
  _getHighestPriority(subtasks) {
    let highest = PRIORITY.LOW;
    for (const st of subtasks) {
      if (st.priority < highest) {
        highest = st.priority;
      }
    }
    return highest;
  }

  /**
   * Execute a plan
   *
   * @param {string} planId - Plan ID
   * @param {object} options - Execution options
   * @param {boolean} options.async - Run asynchronously (default: true)
   * @param {function} options.onSubtaskComplete - Callback on subtask completion
   * @returns {object} Execution result or promise
   */
  async execute(planId, options = {}) {
    const plan = this._load(planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    if (plan.status === PLAN_STATES.RUNNING) {
      throw new Error(`Plan already running: ${planId}`);
    }

    if (plan.status === PLAN_STATES.COMPLETED) {
      return { status: 'already_completed', plan };
    }

    // Update plan status
    plan.status = PLAN_STATES.RUNNING;
    plan.execution.startedAt = new Date().toISOString();
    plan.updatedAt = new Date().toISOString();
    this._save(plan);

    // Create checkpoint before execution
    if (this.sessionManager) {
      const checkpointId = this.sessionManager.checkpoint(`before_plan_${planId}`);
      plan.execution.checkpoints.push(checkpointId);
      this._save(plan);
    }

    // Execute subtasks
    const isAsync = options.async !== false;

    if (isAsync) {
      // Start async execution and return immediately
      const executionPromise = this._executeSubtasks(plan, options);
      this.runningExecutions.set(planId, executionPromise);

      return {
        status: 'started',
        planId,
        subtaskCount: plan.subtasks.length,
        message: 'Plan execution started. Use getStatus() to monitor progress.',
      };
    } else {
      // Synchronous execution
      return this._executeSubtasks(plan, options);
    }
  }

  /**
   * Execute all subtasks in order
   */
  async _executeSubtasks(plan, options = {}) {
    const results = [];

    // Sort subtasks by priority and dependencies
    const sortedSubtasks = this._sortSubtasksByExecution(plan.subtasks);

    for (const subtask of sortedSubtasks) {
      // Check if dependencies are met
      if (!this._areDependenciesMet(subtask, plan)) {
        subtask.status = SUBTASK_STATES.BLOCKED;
        this._save(plan);
        continue;
      }

      // Execute subtask
      plan.execution.currentSubtaskId = subtask.id;
      this._save(plan);

      try {
        const result = await this._executeSubtask(subtask, plan, options);

        // Store result
        plan.results[subtask.id] = result;
        subtask.status = result.status === 'success'
          ? SUBTASK_STATES.COMPLETED
          : SUBTASK_STATES.FAILED;

        // Callback
        if (options.onSubtaskComplete) {
          options.onSubtaskComplete(subtask, result);
        }

        results.push({ subtaskId: subtask.id, result });

      } catch (error) {
        subtask.status = SUBTASK_STATES.FAILED;
        plan.results[subtask.id] = {
          status: 'error',
          error: error.message,
          retryable: subtask.retry.currentAttempt < subtask.retry.maxAttempts,
        };
        results.push({ subtaskId: subtask.id, error: error.message });
      }

      plan.updatedAt = new Date().toISOString();
      this._save(plan);
    }

    // Update final status
    plan.execution.currentSubtaskId = null;
    plan.execution.completedAt = new Date().toISOString();

    const completedCount = plan.subtasks.filter(
      st => st.status === SUBTASK_STATES.COMPLETED,
    ).length;

    if (completedCount === plan.subtasks.length) {
      plan.status = PLAN_STATES.COMPLETED;
    } else if (completedCount > 0) {
      plan.status = PLAN_STATES.PARTIAL;
    } else {
      plan.status = PLAN_STATES.FAILED;
    }

    this._save(plan);

    // Update session context
    if (this.sessionManager) {
      this.sessionManager.set('plans.completed', [
        ...(this.sessionManager.get('plans.completed', [])),
        plan.id,
      ]);
      this.sessionManager.addEvent('plan_completed', {
        planId: plan.id,
        status: plan.status,
        subtasksCompleted: completedCount,
        subtasksTotal: plan.subtasks.length,
      });
    }

    // Clean up running execution
    this.runningExecutions.delete(plan.id);

    return {
      status: plan.status,
      planId: plan.id,
      results: plan.results,
      summary: {
        completed: completedCount,
        failed: plan.subtasks.filter(st => st.status === SUBTASK_STATES.FAILED).length,
        blocked: plan.subtasks.filter(st => st.status === SUBTASK_STATES.BLOCKED).length,
        total: plan.subtasks.length,
      },
    };
  }

  /**
   * Execute a single subtask
   */
  async _executeSubtask(subtask, plan, options = {}) {
    subtask.startedAt = new Date().toISOString();
    subtask.status = SUBTASK_STATES.RUNNING;
    subtask.retry.currentAttempt++;
    this._save(plan);

    // Create checkpoint before subtask
    if (this.sessionManager) {
      const checkpointId = this.sessionManager.checkpoint(`before_subtask_${subtask.id}`);
      plan.execution.checkpoints.push(checkpointId);
    }

    // Populate prior results from dependencies
    subtask.context.priorResults = {};
    for (const depId of subtask.dependencies) {
      if (plan.results[depId]) {
        subtask.context.priorResults[depId] = plan.results[depId];
      }
    }

    // Execute via subagent runner (import dynamically to avoid circular deps)
    const { runSubagent } = await import('./subagent-runner.js');

    const result = await runSubagent(subtask, plan.sessionId, {
      sessionManager: this.sessionManager,
      ...options,
    });

    subtask.completedAt = new Date().toISOString();
    subtask.durationMs = new Date(subtask.completedAt) - new Date(subtask.startedAt);

    return result;
  }

  /**
   * Sort subtasks by priority and dependencies
   */
  _sortSubtasksByExecution(subtasks) {
    // First, sort by priority (lower number = higher priority)
    const sorted = [...subtasks].sort((a, b) => a.priority - b.priority);

    // Then, respect dependencies (topological sort)
    const result = [];
    const pending = new Set(sorted.map(st => st.id));
    const completed = new Set();

    while (pending.size > 0) {
      let added = false;

      for (const subtask of sorted) {
        if (!pending.has(subtask.id)) continue;

        // Check if all dependencies are completed
        const depsOk = subtask.dependencies.every(depId =>
          completed.has(depId) || !pending.has(depId),
        );

        if (depsOk) {
          result.push(subtask);
          pending.delete(subtask.id);
          completed.add(subtask.id);
          added = true;
        }
      }

      // Detect circular dependency
      if (!added && pending.size > 0) {
        // Add remaining subtasks anyway (will be blocked)
        for (const subtask of sorted) {
          if (pending.has(subtask.id)) {
            result.push(subtask);
          }
        }
        break;
      }
    }

    return result;
  }

  /**
   * Check if subtask dependencies are met
   */
  _areDependenciesMet(subtask, plan) {
    if (subtask.dependencies.length === 0) {
      return true;
    }

    const completedDeps = subtask.dependencies.filter(depId => {
      const depSubtask = plan.subtasks.find(st => st.id === depId);
      return depSubtask && depSubtask.status === SUBTASK_STATES.COMPLETED;
    });

    if (subtask.dependencyMode === 'any') {
      return completedDeps.length > 0;
    }

    return completedDeps.length === subtask.dependencies.length;
  }

  /**
   * Get plan status
   *
   * @param {string} planId - Plan ID
   * @returns {object} Plan status
   */
  getStatus(planId) {
    const plan = this._load(planId);
    if (!plan) {
      return { error: 'Plan not found' };
    }

    const subtaskStatuses = plan.subtasks.map(st => ({
      id: st.id,
      sequence: st.sequence,
      status: st.status,
      description: st.description.slice(0, 100),
      priority: st.priority,
      attempts: st.retry.currentAttempt,
      duration: st.durationMs,
    }));

    return {
      planId: plan.id,
      status: plan.status,
      progress: {
        completed: plan.subtasks.filter(st => st.status === SUBTASK_STATES.COMPLETED).length,
        running: plan.subtasks.filter(st => st.status === SUBTASK_STATES.RUNNING).length,
        pending: plan.subtasks.filter(st => st.status === SUBTASK_STATES.PENDING).length,
        failed: plan.subtasks.filter(st => st.status === SUBTASK_STATES.FAILED).length,
        blocked: plan.subtasks.filter(st => st.status === SUBTASK_STATES.BLOCKED).length,
        total: plan.subtasks.length,
      },
      subtasks: subtaskStatuses,
      currentSubtask: plan.execution.currentSubtaskId,
      startedAt: plan.execution.startedAt,
      completedAt: plan.execution.completedAt,
    };
  }

  /**
   * Get subtask result
   *
   * @param {string} planId - Plan ID
   * @param {string} subtaskId - Subtask ID
   * @returns {object} Subtask result
   */
  getSubtaskResult(planId, subtaskId) {
    const plan = this._load(planId);
    if (!plan) {
      return { error: 'Plan not found' };
    }

    const subtask = plan.subtasks.find(st => st.id === subtaskId);
    if (!subtask) {
      return { error: 'Subtask not found' };
    }

    return {
      subtaskId,
      status: subtask.status,
      description: subtask.description,
      result: plan.results[subtaskId] || null,
      startedAt: subtask.startedAt,
      completedAt: subtask.completedAt,
      durationMs: subtask.durationMs,
      attempts: subtask.retry.currentAttempt,
    };
  }

  /**
   * Cancel a running plan
   *
   * @param {string} planId - Plan ID
   * @param {string} reason - Cancellation reason
   * @returns {object} Cancellation result
   */
  async cancel(planId, reason = 'User cancelled') {
    const plan = this._load(planId);
    if (!plan) {
      return { error: 'Plan not found' };
    }

    if (plan.status !== PLAN_STATES.RUNNING) {
      return { error: 'Plan is not running' };
    }

    // Update plan status
    plan.status = PLAN_STATES.CANCELLED;
    plan.execution.completedAt = new Date().toISOString();
    plan.cancelReason = reason;
    plan.updatedAt = new Date().toISOString();

    // Mark pending subtasks as skipped
    for (const subtask of plan.subtasks) {
      if (subtask.status === SUBTASK_STATES.PENDING ||
          subtask.status === SUBTASK_STATES.BLOCKED) {
        subtask.status = SUBTASK_STATES.SKIPPED;
      }
    }

    this._save(plan);

    // Update session context
    if (this.sessionManager) {
      this.sessionManager.addEvent('plan_cancelled', {
        planId,
        reason,
        completedSubtasks: plan.subtasks.filter(
          st => st.status === SUBTASK_STATES.COMPLETED,
        ).length,
      });
    }

    return {
      status: 'cancelled',
      planId,
      reason,
      completedSubtasks: plan.subtasks.filter(
        st => st.status === SUBTASK_STATES.COMPLETED,
      ).map(st => st.id),
    };
  }

  /**
   * Retry failed subtasks in a plan
   *
   * @param {string} planId - Plan ID
   * @returns {object} Retry result
   */
  async retry(planId) {
    const plan = this._load(planId);
    if (!plan) {
      return { error: 'Plan not found' };
    }

    const failedSubtasks = plan.subtasks.filter(
      st => st.status === SUBTASK_STATES.FAILED &&
            st.retry.currentAttempt < st.retry.maxAttempts,
    );

    if (failedSubtasks.length === 0) {
      return { error: 'No retryable subtasks' };
    }

    // Reset failed subtasks to pending
    for (const subtask of failedSubtasks) {
      subtask.status = SUBTASK_STATES.PENDING;
    }

    // Reset plan status
    plan.status = PLAN_STATES.PENDING;
    plan.updatedAt = new Date().toISOString();
    this._save(plan);

    // Re-execute
    return this.execute(planId, { async: true });
  }

  /**
   * List all plans
   *
   * @param {object} filters - Optional filters
   * @returns {object[]} List of plans
   */
  listPlans(filters = {}) {
    this._ensureDir();

    const files = readdirSync(this.basePath).filter(f => f.endsWith('.json'));
    const plans = [];

    for (const file of files) {
      const plan = this._load(file.replace('.json', ''));
      if (!plan) continue;

      // Apply filters
      if (filters.status && plan.status !== filters.status) continue;
      if (filters.sessionId && plan.sessionId !== filters.sessionId) continue;

      plans.push({
        id: plan.id,
        status: plan.status,
        subtaskCount: plan.subtasks.length,
        createdAt: plan.createdAt,
        completedAt: plan.execution.completedAt,
        originalTask: plan.originalTask.description.slice(0, 100),
      });
    }

    return plans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Clean up old completed plans
   *
   * @param {number} olderThanDays - Remove plans older than this
   * @returns {number} Number of plans removed
   */
  cleanup(olderThanDays = 7) {
    this._ensureDir();

    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const files = readdirSync(this.basePath).filter(f => f.endsWith('.json'));
    let removed = 0;

    for (const file of files) {
      const plan = this._load(file.replace('.json', ''));
      if (!plan) continue;

      if (plan.status === PLAN_STATES.COMPLETED &&
          new Date(plan.createdAt).getTime() < cutoff) {
        const path = this._getPlanPath(plan.id);
        try {
          unlinkSync(path);
          this.plans.delete(plan.id);
          removed++;
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    return removed;
  }
}

/**
 * Create a new plan executor
 */
export function createPlanExecutor(options = {}) {
  return new PlanExecutor(options);
}

export default {
  PlanExecutor,
  createPlanExecutor,
  PLAN_STATES,
  SUBTASK_STATES,
  MAX_SUBTASKS,
};
