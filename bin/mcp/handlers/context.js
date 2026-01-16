/**
 * GoodFlows MCP Context Store Handlers
 *
 * Handles context store operations: query, add, update, export, check duplicate
 *
 * @module goodflows/bin/mcp/handlers/context
 */

import { mcpResponse, mcpError } from '../tool-registry.js';

/**
 * Context Store Tool Definitions
 */
export const tools = [
  {
    name: 'goodflows_context_query',
    description: `Query findings from GoodFlows context store. Use this to check for existing findings before creating issues.

Examples:
- Query all open bugs: { "type": "bug", "status": "open" }
- Query by file: { "file": "src/api/auth.js" }
- Query security issues: { "type": "critical_security" }`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Finding type: critical_security, potential_issue, refactor_suggestion, performance, documentation',
        },
        file: {
          type: 'string',
          description: 'File path to filter by (substring match)',
        },
        status: {
          type: 'string',
          description: 'Status: open, in_progress, fixed, wont_fix',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
      },
    },
  },
  {
    name: 'goodflows_context_add',
    description: `Add a finding to the context store. Returns hash for deduplication and linking.

The store automatically:
- Deduplicates by content hash
- Indexes by file and type
- Checks similarity to existing findings`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' },
        lines: { type: 'string', description: 'Line range (e.g., "45-52")' },
        type: { type: 'string', description: 'Finding type' },
        description: { type: 'string', description: 'Finding description' },
        severity: { type: 'string', description: 'Severity level' },
        proposedFix: { type: 'string', description: 'Suggested fix' },
      },
      required: ['file', 'type', 'description'],
    },
  },
  {
    name: 'goodflows_context_update',
    description: 'Update a finding status (e.g., mark as fixed, link to issue)',
    inputSchema: {
      type: 'object',
      properties: {
        hash: { type: 'string', description: 'Finding hash' },
        status: { type: 'string', description: 'New status' },
        issueId: { type: 'string', description: 'Linear issue ID (e.g., GOO-31)' },
      },
      required: ['hash'],
    },
  },
  {
    name: 'goodflows_context_export',
    description: 'Export findings to markdown format for reporting',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by type' },
        status: { type: 'string', description: 'Filter by status' },
        outputPath: { type: 'string', description: 'Output file (default: .goodflows/export.md)' },
      },
    },
  },
  {
    name: 'goodflows_context_check_duplicate',
    description: 'Check if a finding already exists (by hash or similarity)',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        type: { type: 'string' },
        description: { type: 'string' },
        similarityThreshold: { type: 'number', description: 'Similarity threshold 0-1 (default: 0.85)' },
      },
      required: ['description'],
    },
  },
];

/**
 * Context Store Handlers
 */
export const handlers = {
  async goodflows_context_query(args, services) {
    const { contextStore } = services;
    const results = contextStore.query({
      type: args.type,
      file: args.file,
      status: args.status,
      limit: args.limit || 20,
    });
    return mcpResponse({ count: results.length, findings: results });
  },

  async goodflows_context_add(args, services) {
    const { contextStore } = services;
    const result = contextStore.addFinding({
      file: args.file,
      lines: args.lines,
      type: args.type,
      description: args.description,
      severity: args.severity,
      proposedFix: args.proposedFix,
      status: 'open',
    });
    return mcpResponse(result);
  },

  async goodflows_context_update(args, services) {
    const { contextStore } = services;
    const result = contextStore.updateFinding(args.hash, {
      status: args.status,
      issueId: args.issueId,
    });
    return mcpResponse({ success: true, updated: result });
  },

  async goodflows_context_export(args, services) {
    const { contextStore } = services;
    const { writeFileSync } = await import('fs');

    const markdown = contextStore.exportToMarkdown({
      type: args.type,
      status: args.status,
    });
    const outputPath = args.outputPath || '.goodflows/export.md';
    writeFileSync(outputPath, markdown);

    return mcpResponse({
      success: true,
      path: outputPath,
      preview: markdown.slice(0, 500) + '...',
    });
  },

  async goodflows_context_check_duplicate(args, services) {
    const { contextStore } = services;
    const existing = contextStore.findSimilar(args.description, {
      threshold: args.similarityThreshold || 0.85,
      file: args.file,
      type: args.type,
    });
    return mcpResponse({
      isDuplicate: existing.length > 0,
      similarFindings: existing,
    });
  },
};

export default { tools, handlers };
