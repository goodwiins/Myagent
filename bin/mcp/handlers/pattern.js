/**
 * GoodFlows MCP Pattern Tracker Handlers
 *
 * Handles fix pattern operations: recommend, record success/failure, add pattern
 *
 * @module goodflows/bin/mcp/handlers/pattern
 */

import { mcpResponse } from '../tool-registry.js';

/**
 * Pattern Tracker Tool Definitions
 */
export const tools = [
  {
    name: 'goodflows_pattern_recommend',
    description: `Get recommended fix patterns based on finding type and description.

Returns patterns sorted by confidence score. Only apply patterns with confidence > 0.7.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Finding type' },
        description: { type: 'string', description: 'Finding description for similarity matching' },
        minConfidence: { type: 'number', description: 'Minimum confidence (default: 0.5)' },
      },
      required: ['type'],
    },
  },
  {
    name: 'goodflows_pattern_record_success',
    description: 'Record successful fix to improve pattern confidence',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: { type: 'string' },
        file: { type: 'string' },
        issueId: { type: 'string' },
        context: { type: 'string', description: 'Additional context' },
      },
      required: ['patternId'],
    },
  },
  {
    name: 'goodflows_pattern_record_failure',
    description: 'Record failed fix to decrease pattern confidence',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: { type: 'string' },
        file: { type: 'string' },
        issueId: { type: 'string' },
        reason: { type: 'string', description: 'Why the fix failed' },
      },
      required: ['patternId', 'reason'],
    },
  },
  {
    name: 'goodflows_pattern_add',
    description: 'Add a new reusable fix pattern',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Pattern ID (e.g., env-var-secret)' },
        type: { type: 'string', description: 'Finding type this pattern fixes' },
        description: { type: 'string' },
        template: { type: 'string', description: 'Code template for the fix' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords for matching' },
      },
      required: ['id', 'type', 'description'],
    },
  },
];

/**
 * Pattern Tracker Handlers
 */
export const handlers = {
  async goodflows_pattern_recommend(args, services) {
    const { patternTracker } = services;
    const patterns = patternTracker.recommend(args.type, args.description || '', {
      minConfidence: args.minConfidence || 0.5,
    });
    return mcpResponse({ patterns });
  },

  async goodflows_pattern_record_success(args, services) {
    const { patternTracker } = services;
    patternTracker.recordSuccess(args.patternId, {
      file: args.file,
      issueId: args.issueId,
      context: args.context,
    });
    return mcpResponse({ success: true, patternId: args.patternId });
  },

  async goodflows_pattern_record_failure(args, services) {
    const { patternTracker } = services;
    patternTracker.recordFailure(args.patternId, {
      file: args.file,
      issueId: args.issueId,
      reason: args.reason,
    });
    return mcpResponse({ success: true, patternId: args.patternId });
  },

  async goodflows_pattern_add(args, services) {
    const { patternTracker } = services;
    patternTracker.addPattern({
      id: args.id,
      type: args.type,
      description: args.description,
      template: args.template,
      applicability: {
        keywords: args.keywords || [],
      },
    });
    return mcpResponse({ success: true, patternId: args.id });
  },
};

export default { tools, handlers };
