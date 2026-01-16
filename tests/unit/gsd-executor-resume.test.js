/**
 * Tests for GsdExecutor resume functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GsdExecutor, TASK_STATUS } from '../../lib/gsd-executor.js';
import { PhaseManager } from '../../lib/phase-manager.js';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

describe('GsdExecutor Resume', () => {
  let tempDir;
  let gsdExecutor;
  let phaseManager;

  beforeEach(async () => {
    // Create a temp directory for tests
    tempDir = path.join(tmpdir(), `goodflows-resume-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(path.join(tempDir, '.goodflows', 'phases'), { recursive: true });

    phaseManager = new PhaseManager({ basePath: tempDir });
    gsdExecutor = new GsdExecutor({
      basePath: tempDir,
      phaseManager,
      dryRun: true,
    });

    // Mock _executeTask to avoid subagent calls
    vi.spyOn(gsdExecutor, '_executeTask').mockImplementation(async (task) => {
      return {
        id: task.id,
        name: task.name,
        status: TASK_STATUS.COMPLETED,
        duration: '10s',
        filesModified: task.files || [],
        verificationPassed: true,
      };
    });

    // Mock _generateSummary, _updateState, _createMetadataCommit
    vi.spyOn(gsdExecutor, '_generateSummary').mockResolvedValue('SUMMARY.md');
    vi.spyOn(gsdExecutor, '_updateState').mockResolvedValue();
    vi.spyOn(gsdExecutor, '_createMetadataCommit').mockResolvedValue('abc123f');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    vi.restoreAllMocks();
  });

  it('should resume execution from after the checkpoint', async () => {
    // Create a plan with tasks and a checkpoint
    const planContent = `---
phase: 01-foundation
plan: 01
type: execute
---

<tasks>

<task type="auto" id="task-1">
  <name>Task 1</name>
  <action>Action 1</action>
  <done>Done 1</done>
</task>

<task type="checkpoint:human-verify" id="task-2">
  <what-built>Something</what-built>
  <how-to-verify>Check it</how-to-verify>
  <resume-signal>approved</resume-signal>
</task>

<task type="auto" id="task-3">
  <name>Task 3</name>
  <action>Action 3</action>
  <done>Done 3</done>
</task>

</tasks>
`;
    const planPath = path.join(tempDir, 'plan.md');
    await fs.writeFile(planPath, planContent);

    // Resume from task-2 (checkpoint)
    const result = await gsdExecutor.resumeCheckpoint({
      planPath,
      checkpointId: 'task-2',
      approved: true,
      result: { verified: true },
      sessionId: 'session-123',
    });

    expect(result.success).toBe(true);
    expect(result.tasks).toHaveLength(2); // Checkpoint task + Task 3
    expect(result.tasks[0].id).toBe('task-2');
    expect(result.tasks[0].status).toBe(TASK_STATUS.COMPLETED);
    expect(result.tasks[1].id).toBe('task-3');
    expect(result.tasks[1].status).toBe(TASK_STATUS.COMPLETED);
    
    // Ensure _executeTask was only called for Task 3
    expect(gsdExecutor._executeTask).toHaveBeenCalledTimes(1);
    expect(gsdExecutor._executeTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-3' }),
      expect.any(Object)
    );
  });

  it('should fail if checkpoint is not approved', async () => {
    const planContent = `---
phase: 01-foundation
plan: 01
type: execute
---

<tasks>
<task type="checkpoint:human-verify" id="task-1">
  <what-built>Something</what-built>
</task>
<task type="auto" id="task-2">
  <name>Task 2</name>
</task>
</tasks>
`;
    const planPath = path.join(tempDir, 'plan.md');
    await fs.writeFile(planPath, planContent);

    const result = await gsdExecutor.resumeCheckpoint({
      planPath,
      checkpointId: 'task-1',
      approved: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Checkpoint not approved');
    expect(result.tasks[0].status).toBe(TASK_STATUS.FAILED);
    expect(gsdExecutor._executeTask).not.toHaveBeenCalled();
  });

  it('should throw error if checkpointId not found in plan', async () => {
    const planContent = `---
phase: 01-foundation
plan: 01
type: execute
---
<tasks>
<task type="auto" id="task-1"><name>Task 1</name></task>
</tasks>
`;
    const planPath = path.join(tempDir, 'plan.md');
    await fs.writeFile(planPath, planContent);

    await expect(gsdExecutor.resumeCheckpoint({
      planPath,
      checkpointId: 'non-existent',
      approved: true,
    })).rejects.toThrow('Checkpoint not found: non-existent');
  });

  it('should handle nested checkpoints correctly during resume', async () => {
    const planContent = `---
phase: 01-foundation
plan: 01
type: execute
---

<tasks>

<task type="checkpoint:human-verify" id="cp-1">
  <what-built>CP1</what-built>
</task>

<task type="auto" id="task-1">
  <name>Task 1</name>
</task>

<task type="checkpoint:human-verify" id="cp-2">
  <what-built>CP2</what-built>
</task>

<task type="auto" id="task-2">
  <name>Task 2</name>
</task>

</tasks>
`;
    const planPath = path.join(tempDir, 'plan-nested.md');
    await fs.writeFile(planPath, planContent);

    // Resume from cp-1
    const result = await gsdExecutor.resumeCheckpoint({
      planPath,
      checkpointId: 'cp-1',
      approved: true,
      strategy: 'segmented',
    });

    // Should run Task 1 and then stop at cp-2
    expect(result.status).toBe('awaiting_checkpoint');
    expect(result.checkpoint.id).toBe('cp-2');
    expect(result.tasks).toHaveLength(2); // cp-1 and task-1
    expect(result.tasks[0].id).toBe('cp-1');
    expect(result.tasks[1].id).toBe('task-1');
    expect(gsdExecutor._executeTask).toHaveBeenCalledTimes(1);
    expect(gsdExecutor._executeTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1' }),
      expect.any(Object)
    );
  });
});
