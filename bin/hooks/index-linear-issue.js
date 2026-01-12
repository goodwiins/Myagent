#!/usr/bin/env node
/**
 * Hook script to auto-index Linear issues after creation
 *
 * Receives tool result via stdin and indexes to GoodFlows context store
 */

import { ContextStore } from '../../lib/context-store.js';

async function main() {
  // Read stdin (tool result from linear_create_issue)
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (!input.trim()) {
    console.error('No input received');
    process.exit(0);
  }

  try {
    const toolResult = JSON.parse(input);

    // Extract issue data from the tool result
    const issue = toolResult.issue || toolResult;

    if (!issue.identifier && !issue.id) {
      console.error('No issue identifier found in tool result');
      process.exit(0);
    }

    // Determine finding type from labels
    const labels = (issue.labels?.nodes || issue.labels || []).map(l =>
      (typeof l === 'string' ? l : l.name).toLowerCase(),
    );

    let type = 'potential_issue';
    if (labels.includes('security') || labels.includes('critical')) {
      type = 'critical_security';
    } else if (labels.includes('performance')) {
      type = 'performance';
    } else if (labels.includes('improvement') || labels.includes('refactor')) {
      type = 'refactor_suggestion';
    } else if (labels.includes('docs') || labels.includes('documentation')) {
      type = 'documentation';
    }

    // Index to context store
    const contextStore = new ContextStore({ basePath: '.goodflows/context' });

    const result = contextStore.addFinding({
      file: 'linear-hook',
      type,
      description: `[${issue.identifier || issue.id}] ${issue.title}`,
      issueId: issue.identifier || issue.id,
      status: 'open',
      source: 'linear-hook',
      linearId: issue.id,
      createdAt: issue.createdAt || new Date().toISOString(),
    });

    if (result.added) {
      console.log(`Indexed Linear issue: ${issue.identifier || issue.id}`);
    } else {
      console.log(`Issue already indexed: ${issue.identifier || issue.id}`);
    }
  } catch (error) {
    console.error('Failed to parse/index issue:', error.message);
  }
}

main();
