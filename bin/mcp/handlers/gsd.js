/**
 * GoodFlows MCP GSD (Get Shit Done) Executor Handlers
 *
 * Handles GSD operations: execute_plan, commit_task, resume_checkpoint
 *
 * @module goodflows/bin/mcp/handlers/gsd
 */

import { mcpResponse, mcpError } from '../tool-registry.js';

/**
 * GSD Tool Definitions
 */
export const tools = [
  {
    name: 'goodflows_gsd_execute_plan',
    description: `Execute a GSD PLAN.md file with per-task atomic commits.

Features:
- Per-task atomic commits with conventional format: {type}({phase}-{plan}): {task-name}
- Execution strategies: autonomous (full), segmented (pause at checkpoints), decision (pause at decisions)
- Deviation rules: auto-fix bugs, stop for architectural issues, defer enhancements
- Automatic SUMMARY.md generation on completion
- STATE.md updates after execution

Returns execution result including task statuses, commits, deviations, and next steps.
Use dryRun=true to validate the plan without executing.`,
    inputSchema: {
      type: 'object',
      properties: {
        planPath: { type: 'string', description: 'Path to PLAN.md file' },
        phase: { type: ['number', 'string'], description: 'Phase number or name (alternative to planPath)' },
        plan: { type: 'number', description: 'Plan number (used with phase)' },
        sessionId: { type: 'string', description: 'Session ID for tracking' },
        strategy: {
          type: 'string',
          enum: ['auto', 'autonomous', 'segmented', 'decision'],
          description: 'Execution strategy (default: auto - determined by plan)',
        },
        dryRun: { type: 'boolean', description: 'Parse and validate only, do not execute (default: false)' },
      },
    },
  },
  {
    name: 'goodflows_gsd_commit_task',
    description: `Create an atomic commit for a completed task.

Commit format: {type}({phase}-{plan}): {taskName}

Types: feat, fix, test, refactor, perf, chore, docs

IMPORTANT: Never use git add . - only stage specific files for the task.`,
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        taskName: { type: 'string', description: 'Task name for commit message' },
        type: {
          type: 'string',
          enum: ['feat', 'fix', 'test', 'refactor', 'perf', 'chore', 'docs'],
          description: 'Commit type (default: feat)',
        },
        phase: { type: 'string', description: 'Phase identifier' },
        plan: { type: 'string', description: 'Plan identifier' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to stage and commit',
        },
        sessionId: { type: 'string', description: 'Session ID for tracking' },
      },
      required: ['taskId', 'taskName', 'phase', 'plan', 'files'],
    },
  },
  {
    name: 'goodflows_gsd_resume_checkpoint',
    description: `Resume execution after a checkpoint pause.

Use this after verifying a checkpoint gate (human-verify, human-action, or decision).
Pass the checkpoint result to continue execution.`,
    inputSchema: {
      type: 'object',
      properties: {
        planPath: { type: 'string', description: 'Path to PLAN.md file' },
        checkpointId: { type: 'string', description: 'Checkpoint task ID' },
        approved: { type: 'boolean', description: 'Whether checkpoint was approved' },
        result: { type: 'object', description: 'Checkpoint result data' },
        sessionId: { type: 'string', description: 'Session ID' },
      },
      required: ['planPath', 'checkpointId', 'approved'],
    },
  },
];

/**
 * GSD Handlers
 */
export const handlers = {
  async goodflows_gsd_execute_plan(args, services) {
    const { gsdExecutor, phaseManager, activeSessions } = services;

    // Resolve plan path if phase/plan provided instead of direct path
    let planPath = args.planPath;
    if (!planPath && args.phase !== undefined) {
      const plan = phaseManager.getPlan(args.phase, args.plan || 1);
      if (!plan) {
        return mcpError('Plan not found', 'PLAN_NOT_FOUND');
      }
      planPath = plan.path;
    }

    if (!planPath) {
      return mcpError('Either planPath or phase is required', 'INVALID_ARGS');
    }

    // Get session for tracking
    const session = args.sessionId ? activeSessions.get(args.sessionId) : null;

    const result = await gsdExecutor.executePlan({
      planPath,
      session,
      sessionId: args.sessionId,
      strategy: args.strategy || 'auto',
      dryRun: args.dryRun || false,
    });

    return mcpResponse(result);
  },

  async goodflows_gsd_commit_task(args, services) {
    const { gsdExecutor, activeSessions } = services;

    // Get session for tracking
    const session = args.sessionId ? activeSessions.get(args.sessionId) : null;

    const result = await gsdExecutor.commitTask({
      taskId: args.taskId,
      taskName: args.taskName,
      type: args.type || 'feat',
      phase: args.phase,
      plan: args.plan,
      files: args.files,
      session,
    });

    return mcpResponse(result);
  },

  async goodflows_gsd_resume_checkpoint(args, services) {
    const { gsdExecutor, activeSessions } = services;

    // Get session for tracking
    const session = args.sessionId ? activeSessions.get(args.sessionId) : null;

    const result = await gsdExecutor.resumeCheckpoint({
      planPath: args.planPath,
      checkpointId: args.checkpointId,
      approved: args.approved,
      result: args.result,
      session,
      sessionId: args.sessionId,
    });

    return mcpResponse(result);
  },
};

export default { tools, handlers };
