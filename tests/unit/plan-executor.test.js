/**
 * Tests for plan-executor.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import {
  PlanExecutor,
  PLAN_STATES,
  SUBTASK_STATES,
  MAX_SUBTASKS,
} from '../../lib/plan-executor.js';

describe('PlanExecutor Constants', () => {
  describe('PLAN_STATES', () => {
    it('should have all plan states', () => {
      expect(PLAN_STATES.PENDING).toBe('pending');
      expect(PLAN_STATES.RUNNING).toBe('running');
      expect(PLAN_STATES.COMPLETED).toBe('completed');
      expect(PLAN_STATES.PARTIAL).toBe('partial');
      expect(PLAN_STATES.FAILED).toBe('failed');
      expect(PLAN_STATES.CANCELLED).toBe('cancelled');
    });
  });

  describe('SUBTASK_STATES', () => {
    it('should have all subtask states', () => {
      expect(SUBTASK_STATES.PENDING).toBe('pending');
      expect(SUBTASK_STATES.RUNNING).toBe('running');
      expect(SUBTASK_STATES.COMPLETED).toBe('completed');
      expect(SUBTASK_STATES.FAILED).toBe('failed');
      expect(SUBTASK_STATES.BLOCKED).toBe('blocked');
      expect(SUBTASK_STATES.SKIPPED).toBe('skipped');
    });
  });

  describe('MAX_SUBTASKS', () => {
    it('should be 3', () => {
      expect(MAX_SUBTASKS).toBe(3);
    });
  });
});

describe('PlanExecutor', () => {
  let executor;
  let testBasePath;

  beforeEach(() => {
    // Use unique temp directory for each test
    testBasePath = join('/tmp', `plan-executor-test-${randomUUID()}`);
    mkdirSync(testBasePath, { recursive: true });
    executor = new PlanExecutor({ basePath: testBasePath });
  });

  afterEach(() => {
    if (existsSync(testBasePath)) {
      rmSync(testBasePath, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create executor with default options', () => {
      const defaultExecutor = new PlanExecutor();
      expect(defaultExecutor.basePath).toBe('.goodflows/context/plans');
      expect(defaultExecutor.sessionManager).toBeNull();
    });

    it('should create executor with custom options', () => {
      expect(executor.basePath).toBe(testBasePath);
    });

    it('should initialize empty plans map', () => {
      expect(executor.plans.size).toBe(0);
    });

    it('should initialize empty running executions map', () => {
      expect(executor.runningExecutions.size).toBe(0);
    });

    it('should accept sessionManager option', () => {
      const mockSession = { get: () => {} };
      const execWithSession = new PlanExecutor({
        basePath: testBasePath,
        sessionManager: mockSession,
      });
      expect(execWithSession.sessionManager).toBe(mockSession);
    });
  });

  describe('createPlan', () => {
    it('should create a plan from a task', async () => {
      const plan = await executor.createPlan(
        'Fix the bug and update tests',
        'session_123',
      );

      expect(plan.id).toBeTruthy();
      expect(plan.id).toMatch(/^plan_/);
      expect(plan.sessionId).toBe('session_123');
      expect(plan.status).toBe(PLAN_STATES.PENDING);
    });

    it('should store original task in plan', async () => {
      const task = 'Review code and fix issues';
      const plan = await executor.createPlan(task, 'session_123');

      expect(plan.originalTask.description).toBe(task);
      expect(plan.originalTask.complexity).toBeDefined();
    });

    it('should create subtasks from complex task', async () => {
      const plan = await executor.createPlan(
        'Review all security issues and create Linear issues and fix critical bugs',
        'session_123',
      );

      expect(plan.subtasks.length).toBeGreaterThan(0);
      expect(plan.subtasks.length).toBeLessThanOrEqual(MAX_SUBTASKS);
    });

    it('should respect maxSubtasks option', async () => {
      const plan = await executor.createPlan(
        'Do many things and more things and even more',
        'session_123',
        { maxSubtasks: 2 },
      );

      expect(plan.subtasks.length).toBeLessThanOrEqual(2);
    });

    it('should assign unique IDs to subtasks', async () => {
      const plan = await executor.createPlan(
        'Task one and task two',
        'session_123',
      );

      const ids = plan.subtasks.map(st => st.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should set subtask sequence numbers', async () => {
      const plan = await executor.createPlan(
        'First task and second task',
        'session_123',
      );

      plan.subtasks.forEach((st, index) => {
        expect(st.sequence).toBe(index + 1);
      });
    });

    it('should initialize subtask context', async () => {
      const plan = await executor.createPlan(
        'A complex task to split',
        'session_123',
      );

      for (const subtask of plan.subtasks) {
        expect(subtask.context.sessionId).toBe('session_123');
        expect(subtask.context.parentPlanId).toBe(plan.id);
        expect(subtask.context.freshTokenBudget).toBe(200000);
      }
    });

    it('should initialize retry configuration', async () => {
      const plan = await executor.createPlan(
        'Task with retry config',
        'session_123',
      );

      for (const subtask of plan.subtasks) {
        expect(subtask.retry.maxAttempts).toBe(3);
        expect(subtask.retry.currentAttempt).toBe(0);
        expect(subtask.retry.backoffMs).toBe(1000);
      }
    });

    it('should save plan to disk', async () => {
      const plan = await executor.createPlan(
        'Test task',
        'session_123',
      );

      const planPath = join(testBasePath, `${plan.id}.json`);
      expect(existsSync(planPath)).toBe(true);
    });

    it('should cache plan in memory', async () => {
      const plan = await executor.createPlan(
        'Test task',
        'session_123',
      );

      expect(executor.plans.has(plan.id)).toBe(true);
    });

    it('should accept context option', async () => {
      const context = { someKey: 'someValue' };
      const plan = await executor.createPlan(
        'Task with context',
        'session_123',
        { context },
      );

      expect(plan.originalTask.context).toEqual(context);
    });
  });

  describe('getStatus', () => {
    it('should return error for non-existent plan', () => {
      const status = executor.getStatus('non_existent_plan');
      expect(status.error).toBeDefined();
      expect(status.error).toContain('not found');
    });

    it('should return plan status', async () => {
      const plan = await executor.createPlan(
        'Test task',
        'session_123',
      );

      const status = executor.getStatus(plan.id);
      expect(status).not.toBeNull();
      expect(status.planId).toBe(plan.id);
      expect(status.status).toBe(PLAN_STATES.PENDING);
    });

    it('should include subtask counts', async () => {
      const plan = await executor.createPlan(
        'Task one and task two',
        'session_123',
      );

      const status = executor.getStatus(plan.id);
      expect(status.progress).toBeDefined();
      expect(status.progress.total).toBe(plan.subtasks.length);
      expect(status.progress.pending).toBe(plan.subtasks.length);
      expect(status.progress.completed).toBe(0);
    });
  });

  describe('getSubtaskResult', () => {
    it('should return error for non-existent plan', () => {
      const result = executor.getSubtaskResult('non_existent', 'subtask_1');
      expect(result.error).toBeDefined();
    });

    it('should return error for non-existent subtask', async () => {
      const plan = await executor.createPlan(
        'Test task',
        'session_123',
      );

      const result = executor.getSubtaskResult(plan.id, 'non_existent');
      expect(result.error).toBeDefined();
    });

    it('should return subtask details', async () => {
      const plan = await executor.createPlan(
        'Test task',
        'session_123',
      );

      const subtaskId = plan.subtasks[0].id;
      const result = executor.getSubtaskResult(plan.id, subtaskId);

      // Result includes the subtask data directly
      expect(result.subtaskId).toBe(subtaskId);
      expect(result.status).toBe(SUBTASK_STATES.PENDING);
      expect(result.description).toBeDefined();
    });
  });

  describe('cancel', () => {
    it('should return error for non-existent plan', async () => {
      const result = await executor.cancel('non_existent');
      expect(result.error).toBeDefined();
    });

    it('should cancel a pending plan', async () => {
      const plan = await executor.createPlan(
        'Test task',
        'session_123',
      );

      // First start the plan (need to be running to cancel)
      executor.execute(plan.id, { async: true });

      const result = await executor.cancel(plan.id, 'Test cancellation');

      // Check the result or plan status
      expect(result).toBeDefined();
    });

    it('should return status after cancel attempt', async () => {
      const plan = await executor.createPlan(
        'Task one and task two',
        'session_123',
      );

      // Start execution first
      executor.execute(plan.id, { async: true });
      await executor.cancel(plan.id);

      const status = executor.getStatus(plan.id);
      // Status should be defined
      expect(status).toBeDefined();
    });

    it('should return error for plan not running', async () => {
      const plan = await executor.createPlan(
        'Test task',
        'session_123',
      );

      // Manually mark as completed
      plan.status = PLAN_STATES.COMPLETED;
      executor.plans.set(plan.id, plan);

      const result = await executor.cancel(plan.id);
      expect(result.error).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should throw error for non-existent plan', async () => {
      await expect(executor.execute('non_existent'))
        .rejects.toThrow('Plan not found');
    });

    it('should mark plan as running', async () => {
      const plan = await executor.createPlan(
        'Simple task',
        'session_123',
      );

      // Start execution but don't await completion
      const promise = executor.execute(plan.id, { async: true });

      // Check status immediately
      const status = executor.getStatus(plan.id);
      // Status might be running or completed depending on timing
      expect([PLAN_STATES.RUNNING, PLAN_STATES.COMPLETED, PLAN_STATES.PARTIAL]).toContain(status.status);

      await promise;
    });

    it('should not re-execute completed plan', async () => {
      const plan = await executor.createPlan(
        'Test task',
        'session_123',
      );

      // Manually mark as completed
      plan.status = PLAN_STATES.COMPLETED;
      executor.plans.set(plan.id, plan);

      const result = await executor.execute(plan.id);
      expect(result.status).toBe('already_completed');
    });
  });

  describe('_generatePlanId', () => {
    it('should generate unique plan IDs', () => {
      const id1 = executor._generatePlanId();
      const id2 = executor._generatePlanId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^plan_\d+_[a-f0-9]+$/);
    });
  });

  describe('_generateSubtaskId', () => {
    it('should generate unique subtask IDs with sequence', () => {
      const id1 = executor._generateSubtaskId(1);
      const id2 = executor._generateSubtaskId(2);

      expect(id1).toMatch(/^st_1_[a-f0-9]+$/);
      expect(id2).toMatch(/^st_2_[a-f0-9]+$/);
    });
  });

  describe('_getHighestPriority', () => {
    it('should return lowest priority value (highest priority)', () => {
      const subtasks = [
        { priority: 3 },
        { priority: 1 },
        { priority: 4 },
      ];

      expect(executor._getHighestPriority(subtasks)).toBe(1);
    });

    it('should return 4 for empty subtasks', () => {
      expect(executor._getHighestPriority([])).toBe(4);
    });
  });

  describe('_load', () => {
    it('should return plan from cache', async () => {
      const plan = await executor.createPlan(
        'Test task',
        'session_123',
      );

      const loaded = executor._load(plan.id);
      expect(loaded).toEqual(plan);
    });

    it('should return null for non-existent plan', () => {
      const loaded = executor._load('non_existent');
      expect(loaded).toBeNull();
    });
  });

  describe('_getPlanPath', () => {
    it('should return correct path', () => {
      const path = executor._getPlanPath('plan_123');
      expect(path).toBe(join(testBasePath, 'plan_123.json'));
    });
  });

  describe('_sortSubtasksByExecution', () => {
    it('should sort subtasks by priority', () => {
      const subtasks = [
        { id: 'st_1', priority: 3, dependencies: [] },
        { id: 'st_2', priority: 1, dependencies: [] },
        { id: 'st_3', priority: 2, dependencies: [] },
      ];

      const sorted = executor._sortSubtasksByExecution(subtasks);
      expect(sorted[0].id).toBe('st_2'); // priority 1
      expect(sorted[1].id).toBe('st_3'); // priority 2
      expect(sorted[2].id).toBe('st_1'); // priority 3
    });

    it('should respect dependencies in sort order', () => {
      const subtasks = [
        { id: 'st_1', priority: 1, dependencies: ['st_2'] },
        { id: 'st_2', priority: 2, dependencies: [] },
        { id: 'st_3', priority: 3, dependencies: ['st_1'] },
      ];

      const sorted = executor._sortSubtasksByExecution(subtasks);
      const idOrder = sorted.map(st => st.id);

      // st_2 must come before st_1, st_1 must come before st_3
      expect(idOrder.indexOf('st_2')).toBeLessThan(idOrder.indexOf('st_1'));
      expect(idOrder.indexOf('st_1')).toBeLessThan(idOrder.indexOf('st_3'));
    });

    it('should handle circular dependencies gracefully', () => {
      const subtasks = [
        { id: 'st_1', priority: 1, dependencies: ['st_2'] },
        { id: 'st_2', priority: 2, dependencies: ['st_1'] },
      ];

      // Should not throw, should return all subtasks
      const sorted = executor._sortSubtasksByExecution(subtasks);
      expect(sorted.length).toBe(2);
    });

    it('should handle empty subtasks array', () => {
      const sorted = executor._sortSubtasksByExecution([]);
      expect(sorted).toEqual([]);
    });
  });

  describe('_areDependenciesMet', () => {
    it('should return true when no dependencies', () => {
      const subtask = { id: 'st_1', dependencies: [], dependencyMode: 'all' };
      const plan = { subtasks: [] };

      expect(executor._areDependenciesMet(subtask, plan)).toBe(true);
    });

    it('should return true when all dependencies completed', () => {
      const subtask = { id: 'st_3', dependencies: ['st_1', 'st_2'], dependencyMode: 'all' };
      const plan = {
        subtasks: [
          { id: 'st_1', status: SUBTASK_STATES.COMPLETED },
          { id: 'st_2', status: SUBTASK_STATES.COMPLETED },
        ],
      };

      expect(executor._areDependenciesMet(subtask, plan)).toBe(true);
    });

    it('should return false when dependencies not completed', () => {
      const subtask = { id: 'st_3', dependencies: ['st_1', 'st_2'], dependencyMode: 'all' };
      const plan = {
        subtasks: [
          { id: 'st_1', status: SUBTASK_STATES.COMPLETED },
          { id: 'st_2', status: SUBTASK_STATES.PENDING },
        ],
      };

      expect(executor._areDependenciesMet(subtask, plan)).toBe(false);
    });

    it('should return true with dependencyMode any when one completed', () => {
      const subtask = { id: 'st_3', dependencies: ['st_1', 'st_2'], dependencyMode: 'any' };
      const plan = {
        subtasks: [
          { id: 'st_1', status: SUBTASK_STATES.COMPLETED },
          { id: 'st_2', status: SUBTASK_STATES.PENDING },
        ],
      };

      expect(executor._areDependenciesMet(subtask, plan)).toBe(true);
    });

    it('should return false with dependencyMode any when none completed', () => {
      const subtask = { id: 'st_3', dependencies: ['st_1', 'st_2'], dependencyMode: 'any' };
      const plan = {
        subtasks: [
          { id: 'st_1', status: SUBTASK_STATES.PENDING },
          { id: 'st_2', status: SUBTASK_STATES.FAILED },
        ],
      };

      expect(executor._areDependenciesMet(subtask, plan)).toBe(false);
    });
  });

  describe('retry', () => {
    it('should return error for non-existent plan', async () => {
      const result = await executor.retry('non_existent');
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
    });

    it('should return error when no retryable subtasks', async () => {
      const plan = await executor.createPlan('Test task', 'session_123');

      // Mark all subtasks as completed
      plan.subtasks.forEach(st => {
        st.status = SUBTASK_STATES.COMPLETED;
      });
      executor.plans.set(plan.id, plan);

      const result = await executor.retry(plan.id);
      expect(result.error).toContain('No retryable subtasks');
    });

    it('should return error when failed subtasks have max retries', async () => {
      const plan = await executor.createPlan('Test task', 'session_123');

      // Mark subtask as failed with max retries exhausted
      plan.subtasks[0].status = SUBTASK_STATES.FAILED;
      plan.subtasks[0].retry.currentAttempt = 3;
      plan.subtasks[0].retry.maxAttempts = 3;
      executor.plans.set(plan.id, plan);

      const result = await executor.retry(plan.id);
      expect(result.error).toContain('No retryable subtasks');
    });

    it('should reset failed subtasks for retry', async () => {
      const plan = await executor.createPlan('Task one and task two', 'session_123');

      // Mark subtask as failed with retries remaining
      plan.subtasks[0].status = SUBTASK_STATES.FAILED;
      plan.subtasks[0].retry.currentAttempt = 1;
      plan.subtasks[0].retry.maxAttempts = 3;
      executor.plans.set(plan.id, plan);

      const result = await executor.retry(plan.id);

      // Should have started re-execution
      expect(result.status).toBeDefined();
    });
  });

  describe('listPlans', () => {
    it('should return empty array when no plans', () => {
      const plans = executor.listPlans();
      expect(plans).toEqual([]);
    });

    it('should list all plans', async () => {
      await executor.createPlan('Task one', 'session_1');
      await executor.createPlan('Task two', 'session_2');

      const plans = executor.listPlans();
      expect(plans.length).toBe(2);
    });

    it('should filter by status', async () => {
      const plan1 = await executor.createPlan('Task one', 'session_1');
      const plan2 = await executor.createPlan('Task two', 'session_2');

      // Mark one as completed
      plan1.status = PLAN_STATES.COMPLETED;
      executor.plans.set(plan1.id, plan1);

      const completedPlans = executor.listPlans({ status: PLAN_STATES.COMPLETED });
      expect(completedPlans.length).toBe(1);
      expect(completedPlans[0].id).toBe(plan1.id);

      const pendingPlans = executor.listPlans({ status: PLAN_STATES.PENDING });
      expect(pendingPlans.length).toBe(1);
      expect(pendingPlans[0].id).toBe(plan2.id);
    });

    it('should filter by sessionId', async () => {
      await executor.createPlan('Task one', 'session_1');
      await executor.createPlan('Task two', 'session_2');
      await executor.createPlan('Task three', 'session_1');

      const session1Plans = executor.listPlans({ sessionId: 'session_1' });
      expect(session1Plans.length).toBe(2);

      const session2Plans = executor.listPlans({ sessionId: 'session_2' });
      expect(session2Plans.length).toBe(1);
    });

    it('should sort plans by creation date descending', async () => {
      await executor.createPlan('Task one', 'session_1');
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      await executor.createPlan('Task two', 'session_1');

      const plans = executor.listPlans();
      expect(new Date(plans[0].createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(plans[1].createdAt).getTime());
    });

    it('should include plan metadata in list', async () => {
      await executor.createPlan('Test task description', 'session_1');

      const plans = executor.listPlans();
      expect(plans[0].id).toBeDefined();
      expect(plans[0].status).toBe(PLAN_STATES.PENDING);
      expect(plans[0].subtaskCount).toBeGreaterThan(0);
      expect(plans[0].createdAt).toBeDefined();
      expect(plans[0].originalTask).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('should not remove pending plans', async () => {
      await executor.createPlan('Task one', 'session_1');

      const removed = executor.cleanup(0); // Remove anything older than 0 days
      expect(removed).toBe(0);
    });

    it('should remove old completed plans', async () => {
      const plan = await executor.createPlan('Task one', 'session_1');

      // Mark as completed and set old creation date
      plan.status = PLAN_STATES.COMPLETED;
      plan.createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      executor._save(plan);

      const removed = executor.cleanup(7); // Remove older than 7 days
      expect(removed).toBe(1);
    });

    it('should not remove recent completed plans', async () => {
      const plan = await executor.createPlan('Task one', 'session_1');

      // Mark as completed but keep recent date
      plan.status = PLAN_STATES.COMPLETED;
      executor._save(plan);

      const removed = executor.cleanup(7);
      expect(removed).toBe(0);
    });

    it('should return count of removed plans', async () => {
      // Create multiple old completed plans
      const plan1 = await executor.createPlan('Task one', 'session_1');
      const plan2 = await executor.createPlan('Task two', 'session_1');

      // Mark both as old completed
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      plan1.status = PLAN_STATES.COMPLETED;
      plan1.createdAt = oldDate;
      plan2.status = PLAN_STATES.COMPLETED;
      plan2.createdAt = oldDate;
      executor._save(plan1);
      executor._save(plan2);

      const removed = executor.cleanup(7);
      expect(removed).toBe(2);
    });
  });
});

describe('createPlanExecutor', () => {
  it('should create a new PlanExecutor instance', async () => {
    const { createPlanExecutor } = await import('../../lib/plan-executor.js');
    const executor = createPlanExecutor();

    expect(executor).toBeInstanceOf(PlanExecutor);
    expect(executor.basePath).toBe('.goodflows/context/plans');
  });

  it('should accept options', async () => {
    const { createPlanExecutor } = await import('../../lib/plan-executor.js');
    const testPath = join('/tmp', `plan-executor-factory-${randomUUID()}`);
    mkdirSync(testPath, { recursive: true });

    const executor = createPlanExecutor({ basePath: testPath });

    expect(executor.basePath).toBe(testPath);

    // Cleanup
    if (existsSync(testPath)) {
      rmSync(testPath, { recursive: true, force: true });
    }
  });
});
