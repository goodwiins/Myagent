/**
 * GoodFlows MCP Phase Management Handlers
 *
 * Handles GSD phase operations: create, plan, status, complete, list, roadmap_update
 *
 * @module goodflows/bin/mcp/handlers/phase
 */

import { mcpResponse } from '../tool-registry.js';

/**
 * Phase Tool Definitions
 */
export const tools = [
  {
    name: 'goodflows_phase_create',
    description: `Create a new phase in ROADMAP.md.

Phases are numbered sequentially (01, 02, etc.) and stored in .goodflows/phases/{NN}-{name}/.

Example: { "name": "authentication", "goal": "Implement user auth with JWT" }`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Phase name (will be kebab-cased)' },
        goal: { type: 'string', description: 'What this phase achieves' },
        position: { type: 'number', description: 'Where to insert (default: end)' },
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
          description: 'Phase names this depends on',
        },
      },
      required: ['name', 'goal'],
    },
  },
  {
    name: 'goodflows_phase_plan',
    description: `Create atomic PLAN.md(s) for a phase.

Analyzes the phase goal, breaks it into tasks (max 3 per plan), and creates XML PLAN.md files.

Example: { "phase": 2, "sessionId": "...", "maxTasksPerPlan": 3 }`,
    inputSchema: {
      type: 'object',
      properties: {
        phase: { type: ['number', 'string'], description: 'Phase to plan (default: next unplanned)' },
        sessionId: { type: 'string', description: 'Session for context' },
        maxTasksPerPlan: { type: 'number', description: 'Max tasks per plan (default: 3)' },
        includeCodebaseAnalysis: { type: 'boolean', description: 'Analyze codebase for context (default: true)' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              action: { type: 'string' },
              verify: { type: 'string' },
              done: { type: 'string' },
              files: { type: 'array', items: { type: 'string' } },
              type: { type: 'string', enum: ['auto', 'checkpoint:human-verify', 'checkpoint:human-action', 'checkpoint:decision'] },
            },
          },
          description: 'Pre-defined tasks (optional, will be auto-generated if not provided)',
        },
        objective: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            purpose: { type: 'string' },
            output: { type: 'string' },
          },
          description: 'Plan objective',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'goodflows_phase_status',
    description: `Get current phase progress.

Returns:
- Phase info (number, name, status)
- Plans count (total, completed, current, pending)
- Tasks counts and progress percentage
- Next recommended action`,
    inputSchema: {
      type: 'object',
      properties: {
        phase: { type: ['number', 'string'], description: 'Phase to check (default: current)' },
      },
    },
  },
  {
    name: 'goodflows_phase_complete',
    description: `Mark phase as complete and archive summaries.

Verifies all plans are complete before marking phase done.

Example: { "phase": 2, "summary": "REST API with JWT auth" }`,
    inputSchema: {
      type: 'object',
      properties: {
        phase: { type: ['number', 'string'], description: 'Phase to complete' },
        summary: { type: 'string', description: 'One-liner summary of what shipped' },
      },
      required: ['phase'],
    },
  },
  {
    name: 'goodflows_roadmap_update',
    description: `Update ROADMAP.md with current phase progress.

Syncs the roadmap file with actual phase status from disk.`,
    inputSchema: {
      type: 'object',
      properties: {
        milestone: { type: 'string', description: 'Update milestone name' },
        targetDate: { type: 'string', description: 'Update target date' },
      },
    },
  },
  {
    name: 'goodflows_phase_list',
    description: `List all phases and their status.

Returns array of phases with their plans and completion status.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Phase Handlers
 */
export const handlers = {
  async goodflows_phase_create(args, services) {
    const { phaseManager } = services;

    const result = phaseManager.createPhase({
      name: args.name,
      goal: args.goal,
      position: args.position,
      dependsOn: args.dependsOn,
    });
    return mcpResponse(result);
  },

  async goodflows_phase_plan(args, services) {
    const { phaseManager, activeSessions } = services;

    // Get session for context if available
    let sessionContext = null;
    if (args.sessionId) {
      const session = activeSessions.get(args.sessionId);
      if (session) {
        sessionContext = session.getContext();
      }
    }

    const result = phaseManager.planPhase({
      phase: args.phase,
      sessionContext,
      maxTasksPerPlan: args.maxTasksPerPlan || 3,
      includeCodebaseAnalysis: args.includeCodebaseAnalysis !== false,
      tasks: args.tasks,
      objective: args.objective,
    });
    return mcpResponse(result);
  },

  async goodflows_phase_status(args, services) {
    const { phaseManager } = services;

    const result = phaseManager.getPhaseStatus(args.phase);
    return mcpResponse(result);
  },

  async goodflows_phase_complete(args, services) {
    const { phaseManager } = services;

    const result = phaseManager.completePhase(args.phase, {
      summary: args.summary,
    });
    return mcpResponse(result);
  },

  async goodflows_roadmap_update(args, services) {
    const { phaseManager } = services;

    const result = phaseManager.updateRoadmap({
      milestone: args.milestone,
      targetDate: args.targetDate,
    });
    return mcpResponse(result);
  },

  async goodflows_phase_list(args, services) {
    const { phaseManager } = services;

    const phases = phaseManager.listPhases();
    return mcpResponse({ phases });
  },
};

export default { tools, handlers };