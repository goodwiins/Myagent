/**
 * GoodFlows MCP Tracking Handlers
 *
 * Handles session tracking: track_file, track_files, track_issue, track_finding,
 * start_work, complete_work, get_tracking_summary
 *
 * @module goodflows/bin/mcp/handlers/tracking
 */

import { mcpResponse, mcpError } from '../tool-registry.js';

/**
 * Tracking Tool Definitions
 */
export const tools = [
  {
    name: 'goodflows_track_file',
    description: `Track file operation(s) in the current session.

Automatically updates stats and context. Accepts single path or array of paths.

Examples:
- Single: { "sessionId": "...", "path": "src/auth.ts", "action": "created" }
- Multiple: { "sessionId": "...", "paths": ["a.js", "b.js"], "action": "modified" }`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        path: { type: 'string', description: 'Single file path' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Multiple file paths' },
        action: { type: 'string', enum: ['created', 'modified', 'deleted'], description: 'Action type' },
        meta: { type: 'object', description: 'Optional metadata' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'goodflows_track_issue',
    description: `Track an issue operation in the current session.

Example: { "sessionId": "...", "issueId": "GOO-53", "action": "fixed" }`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        issueId: { type: 'string', description: 'Issue ID (e.g., GOO-53)' },
        action: { type: 'string', enum: ['created', 'fixed', 'skipped', 'failed'], description: 'Action type' },
        meta: { type: 'object', description: 'Optional metadata (title, reason, error)' },
      },
      required: ['sessionId', 'issueId'],
    },
  },
  {
    name: 'goodflows_track_finding',
    description: `Track a finding in the current session.

Example: { "sessionId": "...", "finding": { "type": "security", "file": "auth.ts", "description": "..." } }`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        finding: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Finding type' },
            file: { type: 'string', description: 'File path' },
            description: { type: 'string', description: 'Description' },
          },
          required: ['type', 'description'],
        },
      },
      required: ['sessionId', 'finding'],
    },
  },
  {
    name: 'goodflows_start_work',
    description: `Start a unit of work within a session.

Work units group related tracking together. Files and issues tracked after this call
will be linked to this work unit.

Example: { "sessionId": "...", "type": "fix-issue", "meta": { "issueId": "GOO-53", "title": "..." } }`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        type: { type: 'string', description: 'Work type (fix-issue, implement-feature, code-review)' },
        meta: { type: 'object', description: 'Work metadata (issueId, title, description, etc.)' },
      },
      required: ['sessionId', 'type'],
    },
  },
  {
    name: 'goodflows_complete_work',
    description: `Complete the current unit of work.

Calculates totals from tracked items and returns a summary.

Example: { "sessionId": "...", "result": { "success": true, "endpoints": 5 } }`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
        result: { type: 'object', description: 'Result data to include in summary' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'goodflows_get_tracking_summary',
    description: 'Get a summary of all tracked items in the session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
      },
      required: ['sessionId'],
    },
  },
];

/**
 * Tracking Handlers
 */
export const handlers = {
  async goodflows_track_file(args, services) {
    const { activeSessions } = services;

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }

    const action = args.action || 'modified';

    // Handle both single path and multiple paths
    if (args.paths && Array.isArray(args.paths)) {
      session.trackFiles(args.paths, action, args.meta);
      return mcpResponse({ success: true, count: args.paths.length, action });
    } else if (args.path) {
      session.trackFile(args.path, action, args.meta);
      return mcpResponse({ success: true, path: args.path, action });
    } else {
      return mcpError('Either path or paths is required', 'INVALID_ARGS');
    }
  },

  async goodflows_track_issue(args, services) {
    const { activeSessions } = services;

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }
    session.trackIssue(args.issueId, args.action || 'created', args.meta);
    return mcpResponse({ success: true, issueId: args.issueId, action: args.action || 'created' });
  },

  async goodflows_track_finding(args, services) {
    const { activeSessions } = services;

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }
    session.trackFinding(args.finding);
    return mcpResponse({ success: true, finding: args.finding });
  },

  async goodflows_start_work(args, services) {
    const { activeSessions } = services;

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }
    session.startWork(args.type, args.meta);
    return mcpResponse({ success: true, type: args.type, meta: args.meta });
  },

  async goodflows_complete_work(args, services) {
    const { activeSessions } = services;

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }
    const summary = session.completeWork(args.result || {});
    return mcpResponse({ success: true, summary });
  },

  async goodflows_get_tracking_summary(args, services) {
    const { activeSessions } = services;

    const session = activeSessions.get(args.sessionId);
    if (!session) {
      return mcpError('Session not found', 'SESSION_NOT_FOUND');
    }
    const summary = session.getTrackingSummary();
    return mcpResponse(summary);
  },
};

export default { tools, handlers };