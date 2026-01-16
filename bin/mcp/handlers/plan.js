/**
 * GoodFlows MCP Plan Management Handlers
 *
 * Handles plan operations: create, execute, status, subtask_result, cancel,
 * get, create_multi_task, parse, generate_prompt, create_xml, parse_multi_task_plan
 *
 * @module goodflows/bin/mcp/handlers/plan
 */

import { mcpResponse, mcpError } from '../tool-registry.js';

/**
 * Plan Tool Definitions
 */
export const tools = [
  {
    name: 'goodflows_plan_create',
    description: `Create an execution plan from a complex task.

Automatically splits complex tasks into max 3 subtasks, each executed in a fresh subagent context.
This prevents context degradation by ensuring each subtask gets a full 200k token window.

Examples:
- { "task": "Review codebase, fix security issues, add tests", "sessionId": "..." }
- { "task": "Refactor auth module and update documentation", "sessionId": "...", "maxSubtasks": 2 }`,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Complex task description' },
        sessionId: { type: 'string', description: 'Parent session ID' },
        maxSubtasks: { type: 'number', description: 'Maximum subtasks (default: 3, max: 3)' },
        priorityThreshold: { type: 'number', description: 'Only include subtasks at or above this priority (1-4)' },
        context: { type: 'object', description: 'Additional context to pass to subtasks' },
      },
      required: ['task', 'sessionId'],
    },
  },
  {
    name: 'goodflows_plan_execute',
    description: `Start executing a plan.

By default runs asynchronously - returns immediately with plan ID.
Use goodflows_plan_status to monitor progress. Walk away and come back to completed work.

Example: { "planId": "plan_xxx" }`,
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Plan ID to execute' },
        async: { type: 'boolean', description: 'Run asynchronously (default: true)' },
      },
      required: ['planId'],
    },
  },
  {
    name: 'goodflows_plan_status',
    description: `Get current plan status and progress.

Shows:
- Overall plan status (pending, running, completed, partial, failed, cancelled)
- Progress counts (completed, running, pending, failed, blocked subtasks)
- Individual subtask statuses

Use this to monitor async plan execution.`,
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
      },
      required: ['planId'],
    },
  },
  {
    name: 'goodflows_plan_subtask_result',
    description: 'Get the result of a specific completed subtask',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
        subtaskId: { type: 'string', description: 'Subtask ID' },
      },
      required: ['planId', 'subtaskId'],
    },
  },
  {
    name: 'goodflows_plan_cancel',
    description: `Cancel a running plan.

Completed subtasks are preserved. Pending subtasks are marked as skipped.
Use this to stop execution if something goes wrong.`,
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Plan ID' },
        reason: { type: 'string', description: 'Cancellation reason' },
      },
      required: ['planId'],
    },
  },
  {
    name: 'goodflows_plan_get',
    description: `Get a specific plan from a phase.

Returns the parsed PLAN.md content including tasks and metadata.`,
    inputSchema: {
      type: 'object',
      properties: {
        phase: { type: ['number', 'string'], description: 'Phase number or name' },
        plan: { type: 'number', description: 'Plan number' },
      },
      required: ['phase', 'plan'],
    },
  },
  {
    name: 'goodflows_plan_create_multi_task',
    description: `Create a multi-task PLAN.md (GSD format).

Creates a plan with multiple tasks that will be executed sequentially.
Supports checkpoint tasks for human verification.

Example:
{
  "phase": 2,
  "objective": { "description": "Add user auth", "purpose": "Security", "output": "Auth endpoints" },
  "tasks": [
    { "name": "Create user model", "action": "...", "verify": "npm test", "done": "Model exists" },
    { "type": "checkpoint:human-verify", "whatBuilt": "Auth flow", "howToVerify": "Test login" }
  ]
}`,
    inputSchema: {
      type: 'object',
      properties: {
        phase: { type: ['number', 'string'], description: 'Phase number or name' },
        objective: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'What this plan accomplishes' },
            purpose: { type: 'string', description: 'Why this matters' },
            output: { type: 'string', description: 'What artifacts will be created' },
          },
          required: ['description'],
        },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Task type (auto, checkpoint:human-verify, etc.)' },
              name: { type: 'string', description: 'Task name (for auto tasks)' },
              files: { type: 'array', items: { type: 'string' }, description: 'Files to modify' },
              action: { type: 'string', description: 'Implementation instructions' },
              verify: { type: 'string', description: 'Verification command' },
              done: { type: 'string', description: 'Acceptance criteria' },
              whatBuilt: { type: 'string', description: 'For checkpoints: what was built' },
              howToVerify: { type: 'string', description: 'For checkpoints: verification steps' },
              gate: { type: 'string', enum: ['blocking', 'optional'], description: 'For checkpoints: gate type' },
            },
          },
          description: 'Array of task definitions',
        },
        contextFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional context files to reference',
        },
        verification: {
          type: 'array',
          items: { type: 'string' },
          description: 'Verification checklist items',
        },
        successCriteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Success criteria items',
        },
      },
      required: ['phase', 'tasks'],
    },
  },
  {
    name: 'goodflows_plan_parse',
    description: `Parse the XML task definition from PLAN.md.

Returns structured task object with:
- name, type, context, scope, action, verify, done, tracking

Also validates the task and provides warnings/suggestions.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'goodflows_plan_generate_prompt',
    description: 'Generate an agent prompt from the parsed PLAN.md task',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'goodflows_plan_create_xml',
    description: `Create an XML task template for PLAN.md.

Generates structured XML task definition with:
- name, type, context, scope, action, verify, done, tracking

Example input:
{
  "name": "Add user authentication",
  "type": "implementation",
  "why": "Users need to log in securely",
  "files": [{ "path": "src/auth.ts", "action": "create" }],
  "action": "1. Create auth module\\n2. Add JWT handling",
  "checks": [{ "type": "command", "value": "npm test" }],
  "done": "Users can log in and receive JWT token"
}`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Task name' },
        type: {
          type: 'string',
          enum: ['implementation', 'fix', 'refactor', 'review'],
          description: 'Task type (default: implementation)',
        },
        why: { type: 'string', description: 'Why this task matters' },
        dependsOn: { type: 'string', description: 'Prerequisites' },
        session: { type: 'string', description: 'Session ID' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              action: { type: 'string', enum: ['create', 'modify', 'delete'] },
            },
          },
          description: 'Files to create/modify/delete',
        },
        boundaries: { type: 'string', description: 'What NOT to touch' },
        action: { type: 'string', description: 'Step-by-step instructions' },
        checks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['command', 'manual', 'file_exists'] },
              value: { type: 'string' },
            },
          },
          description: 'Verification checks',
        },
        done: { type: 'string', description: 'Definition of done' },
        trackGoodflows: { type: 'boolean', description: 'Enable GoodFlows tracking (default: true)' },
        writeToPlan: { type: 'boolean', description: 'Write to PLAN.md (default: false)' },
      },
      required: ['name', 'action', 'done'],
    },
  },
  {
    name: 'goodflows_parse_multi_task_plan',
    description: `Parse a multi-task PLAN.md file.

Returns structured data including metadata, objective, tasks, and execution strategy.`,
    inputSchema: {
      type: 'object',
      properties: {
        planPath: { type: 'string', description: 'Path to PLAN.md (default: from current phase)' },
        phase: { type: ['number', 'string'], description: 'Phase number or name' },
        plan: { type: 'number', description: 'Plan number' },
      },
    },
  },
];

/**
 * Plan Handlers
 */
export const handlers = {
  async goodflows_plan_create(args, services) {
    const { planExecutor, activeSessions } = services;

    // Get session for context propagation
    const session = activeSessions.get(args.sessionId);
    const sessionContext = session ? session.getContext() : null;

    const result = planExecutor.createPlan(args.task, {
      sessionId: args.sessionId,
      sessionContext,
      maxSubtasks: Math.min(args.maxSubtasks || 3, 3),
      priorityThreshold: args.priorityThreshold,
      context: args.context,
    });
    return mcpResponse(result);
  },

  async goodflows_plan_execute(args, services) {
    const { planExecutor } = services;

    const result = await planExecutor.execute(args.planId, {
      async: args.async !== false, // Default true
    });
    return mcpResponse(result);
  },

  async goodflows_plan_status(args, services) {
    const { planExecutor } = services;

    const result = planExecutor.getStatus(args.planId);
    return mcpResponse(result);
  },

  async goodflows_plan_subtask_result(args, services) {
    const { planExecutor } = services;

    const result = planExecutor.getSubtaskResult(args.planId, args.subtaskId);
    if (!result) {
      return mcpError('Subtask not found or not completed', 'SUBTASK_NOT_FOUND');
    }
    return mcpResponse(result);
  },

  async goodflows_plan_cancel(args, services) {
    const { planExecutor } = services;

    const result = planExecutor.cancel(args.planId, args.reason);
    return mcpResponse(result);
  },

  async goodflows_plan_get(args, services) {
    const { phaseManager } = services;

    const plan = phaseManager.getPlan(args.phase, args.plan);
    if (!plan) {
      return mcpError('Plan not found', 'PLAN_NOT_FOUND');
    }
    return mcpResponse(plan);
  },

  async goodflows_plan_create_multi_task(args, services) {
    const { phaseManager } = services;

    const result = phaseManager.createMultiTaskPlan({
      phase: args.phase,
      objective: args.objective,
      tasks: args.tasks,
      contextFiles: args.contextFiles,
      verification: args.verification,
      successCriteria: args.successCriteria,
    });
    return mcpResponse(result);
  },

  async goodflows_plan_parse(_args, services) {
    const { contextFileManager, parseTask, validateTask } = services;

    const planContent = contextFileManager.read('PLAN');
    if (!planContent.success) {
      return mcpError('Failed to read PLAN.md', 'READ_ERROR');
    }

    const task = parseTask(planContent.content);
    const validation = validateTask(task);

    return mcpResponse({
      task,
      validation,
    });
  },

  async goodflows_plan_generate_prompt(_args, services) {
    const { contextFileManager, parseTask, generateTaskPrompt } = services;

    const planContent = contextFileManager.read('PLAN');
    if (!planContent.success) {
      return mcpError('Failed to read PLAN.md', 'READ_ERROR');
    }

    const task = parseTask(planContent.content);
    const prompt = generateTaskPrompt(task);

    return mcpResponse({ prompt });
  },

  async goodflows_plan_create_xml(args, services) {
    const { contextFileManager, createTaskXml } = services;

    const xml = createTaskXml({
      name: args.name,
      type: args.type || 'implementation',
      why: args.why,
      dependsOn: args.dependsOn,
      session: args.session,
      files: args.files,
      boundaries: args.boundaries,
      action: args.action,
      checks: args.checks,
      done: args.done,
      trackGoodflows: args.trackGoodflows !== false,
    });

    if (args.writeToPlan) {
      contextFileManager.write('PLAN', xml);
      return mcpResponse({ success: true, written: true, xml });
    }

    return mcpResponse({ success: true, xml });
  },

  async goodflows_parse_multi_task_plan(args, services) {
    const { phaseManager, parseMultiTaskPlan } = services;

    let planContent;
    if (args.planPath) {
      const { readFileSync } = await import('fs');
      planContent = readFileSync(args.planPath, 'utf-8');
    } else if (args.phase !== undefined && args.plan !== undefined) {
      const plan = phaseManager.getPlan(args.phase, args.plan);
      if (!plan) {
        return mcpError('Plan not found', 'PLAN_NOT_FOUND');
      }
      planContent = plan.rawContent;
    } else {
      return mcpError('Either planPath or (phase + plan) is required', 'INVALID_ARGS');
    }

    const parsed = parseMultiTaskPlan(planContent);
    return mcpResponse(parsed);
  },
};

export default { tools, handlers };
