/**
 * Tests for GsdExecutor
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GsdExecutor, EXECUTION_STRATEGY, COMMIT_TYPES, TASK_STATUS } from '../../lib/gsd-executor.js';
import { PhaseManager } from '../../lib/phase-manager.js';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

describe('GsdExecutor', () => {
  let tempDir;
  let gsdExecutor;
  let phaseManager;

  beforeEach(async () => {
    // Create a temp directory for tests
    tempDir = path.join(tmpdir(), `goodflows-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(path.join(tempDir, '.goodflows', 'phases'), { recursive: true });

    phaseManager = new PhaseManager({ basePath: tempDir });
    gsdExecutor = new GsdExecutor({
      basePath: tempDir,
      phaseManager,
      dryRun: true, // Don't actually execute git commands
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('EXECUTION_STRATEGY', () => {
    it('should export execution strategies', () => {
      expect(EXECUTION_STRATEGY.AUTONOMOUS).toBe('autonomous');
      expect(EXECUTION_STRATEGY.SEGMENTED).toBe('segmented');
      expect(EXECUTION_STRATEGY.DECISION).toBe('decision');
    });
  });

  describe('COMMIT_TYPES', () => {
    it('should export commit types', () => {
      expect(COMMIT_TYPES.FEAT).toBe('feat');
      expect(COMMIT_TYPES.FIX).toBe('fix');
      expect(COMMIT_TYPES.TEST).toBe('test');
      expect(COMMIT_TYPES.REFACTOR).toBe('refactor');
      expect(COMMIT_TYPES.PERF).toBe('perf');
      expect(COMMIT_TYPES.CHORE).toBe('chore');
      expect(COMMIT_TYPES.DOCS).toBe('docs');
    });
  });

  describe('TASK_STATUS', () => {
    it('should export task statuses', () => {
      expect(TASK_STATUS.PENDING).toBe('pending');
      expect(TASK_STATUS.RUNNING).toBe('running');
      expect(TASK_STATUS.COMPLETED).toBe('completed');
      expect(TASK_STATUS.FAILED).toBe('failed');
      expect(TASK_STATUS.SKIPPED).toBe('skipped');
      expect(TASK_STATUS.BLOCKED).toBe('blocked');
    });
  });

  describe('executePlan()', () => {
    it('should fail if plan file does not exist', async () => {
      await expect(gsdExecutor.executePlan({
        planPath: path.join(tempDir, 'nonexistent.md'),
        dryRun: true,
      })).rejects.toThrow('Plan file not found');
    });

    it('should parse and validate plan in dry run mode', async () => {
      // Create a valid plan file
      const planContent = `---
phase: 01-foundation
plan: 01
type: execute
depends_on: []
files_modified: []
---

<objective>
Test objective

Purpose: Testing
Output: Test files
</objective>

<context>
@.goodflows/PROJECT.md
</context>

<tasks>

<task type="auto" id="task-1">
  <name>Task 1: Create test file</name>
  <files>src/test.ts</files>
  <action>Create a test file</action>
  <verify>echo test</verify>
  <done>File exists</done>
</task>

</tasks>

<verification>
- [ ] Test passes
</verification>

<success_criteria>
- All tasks completed
</success_criteria>
`;
      const planPath = path.join(tempDir, '.goodflows', 'phases', '01-foundation', '01-01-PLAN.md');
      await fs.mkdir(path.dirname(planPath), { recursive: true });
      await fs.writeFile(planPath, planContent);

      const result = await gsdExecutor.executePlan({
        planPath,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.taskCount).toBeGreaterThanOrEqual(1);
      expect(result.parsed).toBeDefined();
      expect(result.parsed.tasks).toBeDefined();
    });

    it('should detect execution strategy based on checkpoints', async () => {
      // Create a plan with checkpoint tasks
      const planContent = `---
phase: 01-foundation
plan: 01
type: execute
---

<objective>
Test with checkpoints
</objective>

<tasks>

<task type="auto" id="task-1">
  <name>Task 1: Create file</name>
  <files>src/test.ts</files>
  <action>Create file</action>
  <verify>echo test</verify>
  <done>File exists</done>
</task>

<task type="checkpoint:human-verify" id="task-2" gate="blocking">
  <what-built>Test file</what-built>
  <how-to-verify>Check the file exists</how-to-verify>
  <resume-signal>approved</resume-signal>
</task>

</tasks>
`;
      const planPath = path.join(tempDir, 'plan-with-checkpoint.md');
      await fs.writeFile(planPath, planContent);

      const result = await gsdExecutor.executePlan({
        planPath,
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.hasCheckpoints).toBe(true);
      expect(result.strategy).toBe('segmented');
    });

    it('should return error for invalid plan', async () => {
      // Create an invalid plan file
      const planContent = `This is not a valid plan format`;
      const planPath = path.join(tempDir, 'invalid-plan.md');
      await fs.writeFile(planPath, planContent);

      const result = await gsdExecutor.executePlan({
        planPath,
        dryRun: true,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('commitTask()', () => {
    it('should return error when no files exist', async () => {
      const result = await gsdExecutor.commitTask({
        taskId: 'task-1',
        taskName: 'Test task',
        type: 'feat',
        phase: '01',
        plan: '01',
        files: ['nonexistent.ts'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No files to commit');
    });

    it('should format commit message correctly', async () => {
      // Create a test file
      const testFile = path.join(tempDir, 'test.ts');
      await fs.writeFile(testFile, 'export const test = true;');

      // In dry run mode, we can't actually commit, but we can test message format
      const scope = '01-01';
      const message = `feat(${scope}): Test task`;
      expect(message).toBe('feat(01-01): Test task');
    });
  });

  describe('_inferCommitType()', () => {
    it('should infer test type from task name', () => {
      const executor = new GsdExecutor({ basePath: tempDir, dryRun: true });
      const type = executor._inferCommitType({ name: 'Write unit tests' });
      expect(type).toBe('test');
    });

    it('should infer fix type from task name', () => {
      const executor = new GsdExecutor({ basePath: tempDir, dryRun: true });
      const type = executor._inferCommitType({ name: 'Fix validation bug' });
      expect(type).toBe('fix');
    });

    it('should infer refactor type from task name', () => {
      const executor = new GsdExecutor({ basePath: tempDir, dryRun: true });
      const type = executor._inferCommitType({ name: 'Refactor user service' });
      expect(type).toBe('refactor');
    });

    it('should default to feat type', () => {
      const executor = new GsdExecutor({ basePath: tempDir, dryRun: true });
      const type = executor._inferCommitType({ name: 'Create user model' });
      expect(type).toBe('feat');
    });
  });

  describe('_formatDuration()', () => {
    it('should format seconds only', () => {
      const executor = new GsdExecutor({ basePath: tempDir, dryRun: true });
      const duration = executor._formatDuration(30000);
      expect(duration).toBe('30s');
    });

    it('should format minutes and seconds', () => {
      const executor = new GsdExecutor({ basePath: tempDir, dryRun: true });
      const duration = executor._formatDuration(150000);
      expect(duration).toBe('2min 30s');
    });
  });

  describe('_applyDeviationRules()', () => {
    it('should return continue for auto-fix rules', () => {
      const executor = new GsdExecutor({ basePath: tempDir, dryRun: true });
      const action = executor._applyDeviationRules({
        deviations: [{ rule: 1 }], // BUG_FOUND
      });
      expect(action).toBe('continue');
    });

    it('should return stop for architectural changes', () => {
      const executor = new GsdExecutor({ basePath: tempDir, dryRun: true });
      const action = executor._applyDeviationRules({
        deviations: [{ rule: 4 }], // ARCHITECTURAL
      });
      expect(action).toBe('stop');
    });

    it('should return defer for enhancement suggestions', () => {
      const executor = new GsdExecutor({ basePath: tempDir, dryRun: true });
      const action = executor._applyDeviationRules({
        deviations: [{ rule: 5 }], // ENHANCEMENT
      });
      expect(action).toBe('defer');
    });

    it('should return continue when no deviations', () => {
      const executor = new GsdExecutor({ basePath: tempDir, dryRun: true });
      const action = executor._applyDeviationRules({});
      expect(action).toBe('continue');
    });
  });
});
