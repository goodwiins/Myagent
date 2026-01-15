/**
 * GoodFlows GSD Plan Executor
 *
 * Executes PLAN.md files with per-task atomic commits, verification,
 * and automatic SUMMARY.md generation.
 *
 * Features:
 * - Per-task atomic commits with conventional format
 * - Execution strategies (autonomous, segmented, decision)
 * - Deviation rules (auto-fix, stop, defer)
 * - Automatic SUMMARY.md generation
 *
 * @module goodflows/lib/gsd-executor
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseMultiTaskPlan } from './xml-task-parser.js';
import { PhaseManager, DEVIATION_RULES } from './phase-manager.js';

/**
 * Execution strategies
 */
export const EXECUTION_STRATEGY = {
  AUTONOMOUS: 'autonomous',   // Full execution without stopping
  SEGMENTED: 'segmented',     // Pause at checkpoints
  DECISION: 'decision',       // Pause at decision checkpoints only
};

/**
 * Commit types for conventional commits
 */
export const COMMIT_TYPES = {
  FEAT: 'feat',
  FIX: 'fix',
  TEST: 'test',
  REFACTOR: 'refactor',
  PERF: 'perf',
  CHORE: 'chore',
  DOCS: 'docs',
};

/**
 * Task execution status
 */
export const TASK_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  BLOCKED: 'blocked',
};

/**
 * GSD Plan Executor
 */
export class GsdExecutor {
  constructor(options = {}) {
    this.basePath = options.basePath || process.cwd();
    this.phaseManager = options.phaseManager || new PhaseManager({ basePath: this.basePath });
    this.sessionManager = options.sessionManager || null;
    this.dryRun = options.dryRun || false;
  }

  /**
   * Execute a GSD plan
   *
   * @param {object} options - Execution options
   * @param {string} options.planPath - Path to PLAN.md file
   * @param {string} options.sessionId - Session ID for tracking
   * @param {string} options.strategy - Execution strategy
   * @param {boolean} options.dryRun - Parse and validate only
   * @returns {Promise<object>} Execution result
   */
  async executePlan(options = {}) {
    const {
      planPath,
      sessionId,
      strategy = 'auto',
      dryRun = this.dryRun,
    } = options;

    // Read and parse plan
    if (!existsSync(planPath)) {
      throw new Error(`Plan file not found: ${planPath}`);
    }

    const planContent = readFileSync(planPath, 'utf-8');
    const parsed = parseMultiTaskPlan(planContent);

    if (!parsed.valid) {
      return {
        success: false,
        error: parsed.error || 'Invalid plan',
        planPath,
      };
    }

    // Determine execution strategy
    const executionStrategy = strategy === 'auto'
      ? (parsed.hasCheckpoints ? EXECUTION_STRATEGY.SEGMENTED : EXECUTION_STRATEGY.AUTONOMOUS)
      : strategy;

    // Dry run - just validate and return parsed plan
    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        planPath,
        strategy: executionStrategy,
        parsed,
        taskCount: parsed.tasks.length,
        hasCheckpoints: parsed.hasCheckpoints,
        checkpointTypes: parsed.checkpointTypes,
      };
    }

    // Execute tasks
    const startTime = Date.now();
    const results = {
      success: true,
      planPath,
      strategy: executionStrategy,
      tasks: [],
      deviations: [],
      summaryCreated: null,
      metadataCommit: null,
      totalDuration: null,
      stateUpdated: false,
      roadmapUpdated: false,
    };

    const phase = parsed.metadata.phase;
    const plan = parsed.metadata.plan;

    for (const task of parsed.tasks) {
      // Check for checkpoint tasks
      if (task.type?.startsWith('checkpoint:')) {
        if (executionStrategy === EXECUTION_STRATEGY.AUTONOMOUS) {
          // Skip checkpoints in autonomous mode
          results.tasks.push({
            id: task.id,
            name: task.whatBuilt || 'Checkpoint',
            status: TASK_STATUS.SKIPPED,
            reason: 'Skipped in autonomous mode',
          });
          continue;
        }

        // Return checkpoint for user interaction
        return {
          ...results,
          checkpoint: {
            id: task.id,
            type: task.type,
            gate: task.gate || 'blocking',
            whatBuilt: task.whatBuilt,
            howToVerify: task.howToVerify,
            resumeSignal: task.resumeSignal,
          },
          status: 'awaiting_checkpoint',
          tasksCompleted: results.tasks.filter(t => t.status === TASK_STATUS.COMPLETED).length,
          tasksRemaining: parsed.tasks.length - results.tasks.length - 1,
        };
      }

      // Execute regular task
      const taskResult = await this._executeTask(task, {
        phase,
        plan,
        sessionId,
      });

      results.tasks.push(taskResult);

      // Track deviations
      if (taskResult.deviations) {
        results.deviations.push(...taskResult.deviations);
      }

      // Check for failure
      if (taskResult.status === TASK_STATUS.FAILED) {
        // Apply deviation rules
        const deviationAction = this._applyDeviationRules(taskResult);

        if (deviationAction === 'stop') {
          results.success = false;
          break;
        } else if (deviationAction === 'defer') {
          // Log to ISSUES.md and continue
          await this._deferToIssues(taskResult, phase, plan);
        }
        // else 'continue' - already logged as failed
      }
    }

    // Calculate duration
    const endTime = Date.now();
    const durationMs = endTime - startTime;
    results.totalDuration = this._formatDuration(durationMs);

    // Generate SUMMARY.md
    const summaryPath = await this._generateSummary({
      planPath,
      phase,
      plan,
      tasks: results.tasks,
      deviations: results.deviations,
      duration: results.totalDuration,
      startTime,
      endTime,
    });
    results.summaryCreated = summaryPath;

    // Create metadata commit
    if (!dryRun && results.tasks.some(t => t.commitHash)) {
      const metadataCommit = await this._createMetadataCommit(phase, plan, planPath);
      results.metadataCommit = metadataCommit;
    }

    // Update STATE.md
    await this._updateState(phase, plan, results);
    results.stateUpdated = true;

    // Determine next step
    results.nextStep = this._determineNextStep(results);

    return results;
  }

  /**
   * Execute a single task
   */
  async _executeTask(task, context) {
    const { phase, plan, sessionId } = context;
    const taskStart = Date.now();

    const result = {
      id: task.id,
      name: task.name,
      status: TASK_STATUS.RUNNING,
      commitHash: null,
      commitType: null,
      duration: null,
      filesModified: [],
      verificationPassed: false,
      deviations: [],
    };

    try {
      // Parse files from task
      const files = task.files
        ? (typeof task.files === 'string' ? task.files.split(',').map(f => f.trim()) : task.files)
        : [];

      result.filesModified = files;

      // In real execution, the task would be executed by a subagent
      // For now, we simulate task completion and focus on commit workflow

      // Run verification if specified
      if (task.verify) {
        const verifyResult = await this._runVerification(task.verify);
        result.verificationPassed = verifyResult.passed;

        if (!verifyResult.passed) {
          // Apply deviation rule 1: Bug found
          result.deviations.push({
            rule: DEVIATION_RULES.BUG_FOUND,
            category: 'verification_failed',
            description: `Verification failed: ${verifyResult.error || 'Unknown error'}`,
            task: task.id,
            autoFixed: false,
          });
        }
      } else {
        result.verificationPassed = true;
      }

      // Create commit if files were modified
      if (files.length > 0 && !this.dryRun) {
        const commitResult = await this.commitTask({
          taskId: task.id,
          taskName: task.name,
          type: this._inferCommitType(task),
          phase,
          plan,
          files,
          sessionId,
        });

        if (commitResult.success) {
          result.commitHash = commitResult.commitHash;
          result.commitType = commitResult.type;
        }
      }

      result.status = TASK_STATUS.COMPLETED;

    } catch (error) {
      result.status = TASK_STATUS.FAILED;
      result.error = error.message;
    }

    // Calculate duration
    result.duration = this._formatDuration(Date.now() - taskStart);

    return result;
  }

  /**
   * Create an atomic commit for a task
   *
   * @param {object} options - Commit options
   * @returns {Promise<object>} Commit result
   */
  async commitTask(options) {
    const {
      taskId,
      taskName,
      type = COMMIT_TYPES.FEAT,
      phase,
      plan,
      files,
      sessionId,
    } = options;

    // Validate files exist
    const existingFiles = files.filter(f => existsSync(f));
    if (existingFiles.length === 0) {
      return {
        success: false,
        error: 'No files to commit',
        taskId,
      };
    }

    // Format commit message
    const scope = `${phase}-${plan}`;
    const message = `${type}(${scope}): ${taskName}`;

    try {
      // Stage files individually (NEVER git add .)
      for (const file of existingFiles) {
        execSync(`git add "${file}"`, { stdio: 'pipe' });
      }

      // Check if there are staged changes
      const status = execSync('git diff --cached --name-only', { encoding: 'utf-8' });
      if (!status.trim()) {
        return {
          success: false,
          error: 'No changes staged',
          taskId,
        };
      }

      // Create commit
      execSync(`git commit -m "${message}"`, { stdio: 'pipe' });

      // Get commit hash
      const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();

      // Track in session
      if (this.sessionManager && sessionId) {
        this.sessionManager.trackFile(taskId, 'committed', {
          hash: commitHash,
          message,
          files: existingFiles,
        });
      }

      return {
        success: true,
        commitHash,
        commitMessage: message,
        type,
        filesStaged: existingFiles,
        tracked: !!sessionId,
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        taskId,
      };
    }
  }

  /**
   * Run verification command
   */
  async _runVerification(verifyCommand) {
    try {
      execSync(verifyCommand, { stdio: 'pipe', timeout: 60000 });
      return { passed: true };
    } catch (error) {
      return {
        passed: false,
        error: error.message,
      };
    }
  }

  /**
   * Apply deviation rules based on task result
   */
  _applyDeviationRules(taskResult) {
    if (!taskResult.deviations || taskResult.deviations.length === 0) {
      return 'continue';
    }

    for (const deviation of taskResult.deviations) {
      switch (deviation.rule) {
        case DEVIATION_RULES.BUG_FOUND:
        case DEVIATION_RULES.CRITICAL_MISSING:
        case DEVIATION_RULES.BLOCKER:
          // Auto-fix rules - continue execution
          return 'continue';

        case DEVIATION_RULES.ARCHITECTURAL:
          // Stop and ask user
          return 'stop';

        case DEVIATION_RULES.ENHANCEMENT:
          // Log to ISSUES.md and continue
          return 'defer';

        default:
          return 'continue';
      }
    }

    return 'continue';
  }

  /**
   * Defer issue to ISSUES.md
   */
  async _deferToIssues(taskResult, phase, plan) {
    const issuesPath = join(this.basePath, '.goodflows', 'ISSUES.md');

    let content = '';
    if (existsSync(issuesPath)) {
      content = readFileSync(issuesPath, 'utf-8');
    }

    // Generate issue ID
    const issueCount = (content.match(/### ISS-\d+/g) || []).length;
    const issueId = `ISS-${String(issueCount + 1).padStart(3, '0')}`;

    const issueEntry = `
### ${issueId}: ${taskResult.name} - Deferred
- **Phase**: ${phase} (Task ${taskResult.id})
- **Type**: tech-debt
- **Effort**: M
- **Priority**: medium
- **Description**: ${taskResult.error || 'Task could not be completed'}
- **Proposed fix**: Review and retry task
`;

    // Insert after "## Open Issues"
    if (content.includes('## Open Issues')) {
      content = content.replace(
        '## Open Issues\n',
        `## Open Issues\n${issueEntry}`,
      );
    } else {
      content += `\n## Open Issues\n${issueEntry}`;
    }

    writeFileSync(issuesPath, content, 'utf-8');

    return issueId;
  }

  /**
   * Generate SUMMARY.md for completed plan
   */
  async _generateSummary(data) {
    const {
      planPath,
      phase,
      plan,
      tasks,
      deviations,
      duration,
      startTime,
      endTime,
    } = data;

    // Extract phase name from path
    const planDir = dirname(planPath);
    const phaseName = planDir.split('/').pop()?.replace(/^\d+-/, '') || phase;

    // Build task commits section
    const taskCommits = tasks
      .filter(t => t.commitHash)
      .map((t, i) => `${i + 1}. **${t.name}** - \`${t.commitHash}\` (${t.commitType || 'feat'})`)
      .join('\n');

    // Build accomplishments
    const accomplishments = tasks
      .filter(t => t.status === TASK_STATUS.COMPLETED)
      .map(t => t.name);

    // Build deviations section
    const autoFixedDeviations = deviations
      .filter(d => d.autoFixed)
      .map((d, i) => `**${i + 1}. [Rule ${d.rule} - ${d.category}] ${d.description}**
- **Found during**: Task ${d.task}
- **Issue**: ${d.description}
- **Fix**: Auto-fixed
- **Verification**: Passed`);

    const deferredDeviations = deviations
      .filter(d => !d.autoFixed)
      .map(d => `- ${d.issueId || 'Deferred'}: ${d.description} (Task ${d.task})`);

    // Get files modified
    const filesCreated = [];
    const filesModified = [];
    for (const task of tasks) {
      for (const file of task.filesModified || []) {
        if (!filesModified.includes(file)) {
          filesModified.push(file);
        }
      }
    }

    const summaryContent = `---
phase: ${phase}-${phaseName}
plan: ${plan}
subsystem: core
tags: []

requires:
  - phase: none
    provides: none
provides:
  - Completed plan ${plan}
affects: []

tech-stack:
  added: []
  patterns: []

key-files:
  created: ${JSON.stringify(filesCreated)}
  modified: ${JSON.stringify(filesModified)}

key-decisions: []

patterns-established: []

issues-created: []

duration: ${duration}
completed: ${new Date(endTime).toISOString().split('T')[0]}
---

# Phase ${phase} Plan ${plan}: ${phaseName} Summary

**${accomplishments.length > 0 ? accomplishments[0] : 'Plan executed'}**

## Performance
- **Duration**: ${duration}
- **Started**: ${new Date(startTime).toISOString()}
- **Completed**: ${new Date(endTime).toISOString()}
- **Tasks**: ${tasks.length}
- **Files modified**: ${filesModified.length}

## Accomplishments
${accomplishments.map(a => `- ${a}`).join('\n') || '- Plan completed'}

## Task Commits
Each task committed atomically:

${taskCommits || '*No commits recorded*'}

## Files Created/Modified
${filesModified.map(f => `- \`${f}\``).join('\n') || '*None*'}

## Decisions Made
*None*

## Deviations from Plan

### Auto-fixed Issues
${autoFixedDeviations.join('\n\n') || '*None*'}

### Deferred Enhancements
${deferredDeviations.join('\n') || '*None*'}

## Issues Encountered
${tasks.filter(t => t.status === TASK_STATUS.FAILED).map(t => `- ${t.name}: ${t.error}`).join('\n') || '*None*'}

## Next Phase Readiness
${tasks.every(t => t.status === TASK_STATUS.COMPLETED) ? 'Ready to proceed to next plan' : 'Some tasks incomplete - review needed'}

---
*Completed: ${new Date(endTime).toISOString()}*
`;

    // Write summary
    const summaryPath = planPath.replace('-PLAN.md', '-SUMMARY.md');
    writeFileSync(summaryPath, summaryContent, 'utf-8');

    return summaryPath;
  }

  /**
   * Create metadata commit after plan completion
   */
  async _createMetadataCommit(phase, plan, planPath) {
    try {
      const summaryPath = planPath.replace('-PLAN.md', '-SUMMARY.md');

      // Stage summary file
      if (existsSync(summaryPath)) {
        execSync(`git add "${summaryPath}"`, { stdio: 'pipe' });
      }

      const message = `docs(${phase}-${plan}): complete plan`;
      execSync(`git commit -m "${message}"`, { stdio: 'pipe' });

      return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      return null;
    }
  }

  /**
   * Update STATE.md after plan execution
   */
  async _updateState(phase, plan, results) {
    const statePath = join(this.basePath, '.goodflows', 'STATE.md');

    if (!existsSync(statePath)) {
      return;
    }

    let content = readFileSync(statePath, 'utf-8');

    // Update position
    const completedCount = results.tasks.filter(t => t.status === TASK_STATUS.COMPLETED).length;
    const status = results.success ? 'Complete' : 'Partial';

    content = content.replace(
      /## Current Position[\s\S]*?(?=\n## )/,
      `## Current Position
- **Phase**: ${phase}
- **Plan**: ${plan} (${status})
- **Status**: ${completedCount}/${results.tasks.length} tasks completed
- **Last activity**: ${new Date().toISOString().split('T')[0]} — Plan ${plan} executed

`,
    );

    writeFileSync(statePath, content, 'utf-8');
  }

  /**
   * Determine next step after execution
   */
  _determineNextStep(results) {
    if (!results.success) {
      return 'Review failed tasks and retry or defer';
    }

    if (results.checkpoint) {
      return `Verify checkpoint: ${results.checkpoint.whatBuilt}`;
    }

    return 'Execute next plan or complete phase';
  }

  /**
   * Infer commit type from task
   */
  _inferCommitType(task) {
    const name = (task.name || '').toLowerCase();
    const action = (task.action || '').toLowerCase();

    if (name.includes('test') || action.includes('test')) {
      return COMMIT_TYPES.TEST;
    }
    if (name.includes('fix') || action.includes('fix')) {
      return COMMIT_TYPES.FIX;
    }
    if (name.includes('refactor') || action.includes('refactor')) {
      return COMMIT_TYPES.REFACTOR;
    }
    if (name.includes('perf') || action.includes('performance')) {
      return COMMIT_TYPES.PERF;
    }
    if (name.includes('doc') || action.includes('document')) {
      return COMMIT_TYPES.DOCS;
    }

    return COMMIT_TYPES.FEAT;
  }

  /**
   * Format duration in human-readable format
   */
  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}min ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  }
}

/**
 * Create a GSD executor instance
 */
export function createGsdExecutor(options = {}) {
  return new GsdExecutor(options);
}

export default {
  GsdExecutor,
  createGsdExecutor,
  EXECUTION_STRATEGY,
  COMMIT_TYPES,
  TASK_STATUS,
};
