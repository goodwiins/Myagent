/**
 * GoodFlows XML Task Parser
 *
 * Parses XML-formatted task definitions from PLAN.md
 * Extracts structured information for precise task execution.
 *
 * @module goodflows/lib/xml-task-parser
 */

/**
 * Task types
 */
export const TASK_TYPES = {
  IMPLEMENTATION: 'implementation',
  FIX: 'fix',
  REFACTOR: 'refactor',
  REVIEW: 'review',
  AUTO: 'auto',
};

/**
 * Check types for verification
 */
export const CHECK_TYPES = {
  COMMAND: 'command',
  MANUAL: 'manual',
  FILE_EXISTS: 'file_exists',
  CONTAINS: 'contains',
};

/**
 * Parse an XML task definition
 * @param {string} xml - XML content from PLAN.md
 * @returns {object} Parsed task object
 */
export function parseTask(xml) {
  if (!xml || typeof xml !== 'string') {
    return { valid: false, error: 'No XML content provided' };
  }

  // Extract task element
  const taskMatch = xml.match(/<task[^>]*>([\s\S]*?)<\/task>/i);
  if (!taskMatch) {
    return { valid: false, error: 'No <task> element found' };
  }

  const taskContent = taskMatch[1];
  const taskAttrs = taskMatch[0].match(/<task([^>]*)>/)?.[1] || '';

  // Parse task type
  const typeMatch = taskAttrs.match(/type=["']([^"']+)["']/);
  const type = typeMatch ? typeMatch[1] : TASK_TYPES.AUTO;

  // Parse required fields
  const name = extractElement(taskContent, 'name');
  const action = extractElement(taskContent, 'action');
  const done = extractElement(taskContent, 'done');

  // Validate required fields
  const errors = [];
  if (!name) errors.push('Missing <name> element');
  if (!action) errors.push('Missing <action> element');
  if (!done) errors.push('Missing <done> element');

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Parse optional context
  const context = parseContext(taskContent);

  // Parse scope (files and boundaries)
  const scope = parseScope(taskContent);

  // Parse verification checks
  const verify = parseVerification(taskContent);

  // Parse tracking options
  const tracking = parseTracking(taskContent);

  return {
    valid: true,
    task: {
      type,
      name: name.trim(),
      context,
      scope,
      action: action.trim(),
      verify,
      done: done.trim(),
      tracking,
    },
  };
}

/**
 * Parse context section
 */
function parseContext(content) {
  const contextMatch = content.match(/<context>([\s\S]*?)<\/context>/i);
  if (!contextMatch) {
    return null;
  }

  const contextContent = contextMatch[1];

  return {
    why: extractElement(contextContent, 'why')?.trim() || null,
    dependsOn: extractElement(contextContent, 'depends-on')?.trim() || null,
    session: extractElement(contextContent, 'session')?.trim() || null,
  };
}

/**
 * Parse scope section
 */
function parseScope(content) {
  const scopeMatch = content.match(/<scope>([\s\S]*?)<\/scope>/i);
  if (!scopeMatch) {
    return { files: [], boundaries: null };
  }

  const scopeContent = scopeMatch[1];

  // Parse files
  const files = [];
  const fileRegex = /<file[^>]*action=["']([^"']+)["'][^>]*>([^<]+)<\/file>/gi;
  let fileMatch;

  while ((fileMatch = fileRegex.exec(scopeContent)) !== null) {
    files.push({
      action: fileMatch[1],
      path: fileMatch[2].trim(),
    });
  }

  // Also handle files without action attribute
  const simpleFileRegex = /<file>([^<]+)<\/file>/gi;
  while ((fileMatch = simpleFileRegex.exec(scopeContent)) !== null) {
    files.push({
      action: 'modify',
      path: fileMatch[1].trim(),
    });
  }

  // Parse boundaries
  const boundaries = extractElement(scopeContent, 'boundaries')?.trim() || null;

  return { files, boundaries };
}

/**
 * Parse verification section
 */
function parseVerification(content) {
  const verifyMatch = content.match(/<verify>([\s\S]*?)<\/verify>/i);
  if (!verifyMatch) {
    return [];
  }

  const verifyContent = verifyMatch[1];
  const checks = [];

  // Parse check elements
  const checkRegex = /<check[^>]*type=["']([^"']+)["'][^>]*>([^<]+)<\/check>/gi;
  let checkMatch;

  while ((checkMatch = checkRegex.exec(verifyContent)) !== null) {
    checks.push({
      type: checkMatch[1],
      value: checkMatch[2].trim(),
    });
  }

  // Also parse simple checks without type
  const simpleCheckRegex = /<check>([^<]+)<\/check>/gi;
  while ((checkMatch = simpleCheckRegex.exec(verifyContent)) !== null) {
    checks.push({
      type: CHECK_TYPES.MANUAL,
      value: checkMatch[1].trim(),
    });
  }

  return checks;
}

/**
 * Parse tracking section
 */
function parseTracking(content) {
  const trackingMatch = content.match(/<tracking>([\s\S]*?)<\/tracking>/i);
  if (!trackingMatch) {
    return {
      goodflows: true, // Default to enabled
      trackFiles: true,
      trackIssues: true,
    };
  }

  const trackingContent = trackingMatch[1];

  return {
    goodflows: extractElement(trackingContent, 'goodflows')?.toLowerCase() !== 'false',
    trackFiles: extractElement(trackingContent, 'track-files')?.toLowerCase() !== 'false',
    trackIssues: extractElement(trackingContent, 'track-issues')?.toLowerCase() !== 'false',
  };
}

/**
 * Extract content from an XML element
 */
function extractElement(content, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = content.match(regex);
  return match ? match[1] : null;
}

/**
 * Generate a verification script from parsed checks
 * @param {object[]} checks - Parsed verification checks
 * @returns {string} Bash script for verification
 */
export function generateVerificationScript(checks) {
  if (!checks || checks.length === 0) {
    return '#!/bin/bash\necho "No verification checks defined"\nexit 0';
  }

  const lines = [
    '#!/bin/bash',
    'set -e',
    'echo "Running verification checks..."',
    '',
  ];

  let checkNum = 1;
  for (const check of checks) {
    lines.push(`echo "Check ${checkNum}: ${check.value.substring(0, 50)}..."`);

    switch (check.type) {
      case CHECK_TYPES.COMMAND:
        lines.push(`if ${check.value}; then`);
        lines.push(`  echo "  ✓ Passed"`);
        lines.push(`else`);
        lines.push(`  echo "  ✗ Failed"`);
        lines.push(`  exit 1`);
        lines.push(`fi`);
        break;

      case CHECK_TYPES.FILE_EXISTS:
        lines.push(`if [ -f "${check.value}" ]; then`);
        lines.push(`  echo "  ✓ File exists"`);
        lines.push(`else`);
        lines.push(`  echo "  ✗ File not found: ${check.value}"`);
        lines.push(`  exit 1`);
        lines.push(`fi`);
        break;

      case CHECK_TYPES.MANUAL:
        lines.push(`echo "  → Manual check required: ${check.value}"`);
        break;

      default:
        lines.push(`echo "  → Unknown check type: ${check.type}"`);
    }

    lines.push('');
    checkNum++;
  }

  lines.push('echo "All checks passed!"');
  lines.push('exit 0');

  return lines.join('\n');
}

/**
 * Validate a task against common issues
 * @param {object} task - Parsed task object
 * @returns {object} Validation result with warnings
 */
export function validateTask(task) {
  const warnings = [];
  const suggestions = [];

  if (!task.valid) {
    return { valid: false, errors: task.errors || [task.error] };
  }

  const { task: t } = task;

  // Check for vague action descriptions
  if (t.action.length < 50) {
    warnings.push('Action description is very short - consider adding more detail');
  }

  // Check for missing verification
  if (!t.verify || t.verify.length === 0) {
    warnings.push('No verification checks defined - consider adding <verify> section');
  }

  // Check for missing file scope
  if (!t.scope.files || t.scope.files.length === 0) {
    suggestions.push('No files specified in scope - add <files> section for better tracking');
  }

  // Check for command-based verification
  const hasCommandCheck = t.verify?.some(v => v.type === CHECK_TYPES.COMMAND);
  if (!hasCommandCheck && t.verify?.length > 0) {
    suggestions.push('Consider adding command-based verification for automated checking');
  }

  // Check context
  if (!t.context?.why) {
    suggestions.push('Adding <why> in context helps clarify task purpose');
  }

  return {
    valid: true,
    warnings,
    suggestions,
    score: 100 - (warnings.length * 10) - (suggestions.length * 5),
  };
}

/**
 * Generate a task prompt from parsed task
 * @param {object} parsedTask - Parsed task object
 * @param {object} options - Options
 * @returns {string} Formatted prompt for agent execution
 */
export function generateTaskPrompt(parsedTask, _options = {}) {
  if (!parsedTask.valid) {
    throw new Error(`Invalid task: ${parsedTask.errors?.join(', ') || parsedTask.error}`);
  }

  const { task: t } = parsedTask;
  const parts = [];

  // Header
  parts.push(`# Task: ${t.name}`);
  parts.push(`**Type**: ${t.type}`);
  parts.push('');

  // Context
  if (t.context) {
    parts.push('## Context');
    if (t.context.why) parts.push(`**Why**: ${t.context.why}`);
    if (t.context.dependsOn) parts.push(`**Depends On**: ${t.context.dependsOn}`);
    if (t.context.session) parts.push(`**Session**: ${t.context.session}`);
    parts.push('');
  }

  // Scope
  if (t.scope.files.length > 0 || t.scope.boundaries) {
    parts.push('## Scope');
    if (t.scope.files.length > 0) {
      parts.push('### Files');
      for (const file of t.scope.files) {
        parts.push(`- \`${file.path}\` (${file.action})`);
      }
    }
    if (t.scope.boundaries) {
      parts.push(`### Boundaries`);
      parts.push(t.scope.boundaries);
    }
    parts.push('');
  }

  // Action
  parts.push('## Action');
  parts.push(t.action);
  parts.push('');

  // Verification
  if (t.verify.length > 0) {
    parts.push('## Verification');
    for (const check of t.verify) {
      const icon = check.type === CHECK_TYPES.COMMAND ? '🔧' :
                   check.type === CHECK_TYPES.FILE_EXISTS ? '📁' : '👁️';
      parts.push(`- ${icon} [${check.type}] ${check.value}`);
    }
    parts.push('');
  }

  // Done criteria
  parts.push('## Definition of Done');
  parts.push(t.done);
  parts.push('');

  // Tracking reminder
  if (t.tracking.goodflows) {
    parts.push('## Tracking');
    parts.push('**MANDATORY**: Use GoodFlows tracking tools:');
    parts.push('1. `goodflows_start_work` at the beginning');
    if (t.tracking.trackFiles) {
      parts.push('2. `goodflows_track_file` for each file operation');
    }
    if (t.tracking.trackIssues) {
      parts.push('3. `goodflows_track_issue` for issue operations');
    }
    parts.push('4. `goodflows_complete_work` before finishing');
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Create a task XML from structured input
 * @param {object} taskData - Task data
 * @returns {string} XML task definition
 */
export function createTaskXml(taskData) {
  const {
    type = 'implementation',
    name,
    why,
    dependsOn,
    session,
    files = [],
    boundaries,
    action,
    checks = [],
    done,
    trackGoodflows = true,
  } = taskData;

  const lines = [`<task type="${type}">`];
  lines.push(`  <name>${escapeXml(name)}</name>`);
  lines.push('');

  // Context
  if (why || dependsOn || session) {
    lines.push('  <context>');
    if (why) lines.push(`    <why>${escapeXml(why)}</why>`);
    if (dependsOn) lines.push(`    <depends-on>${escapeXml(dependsOn)}</depends-on>`);
    if (session) lines.push(`    <session>${escapeXml(session)}</session>`);
    lines.push('  </context>');
    lines.push('');
  }

  // Scope
  if (files.length > 0 || boundaries) {
    lines.push('  <scope>');
    if (files.length > 0) {
      lines.push('    <files>');
      for (const file of files) {
        const fileAction = typeof file === 'string' ? 'modify' : file.action;
        const filePath = typeof file === 'string' ? file : file.path;
        lines.push(`      <file action="${fileAction}">${escapeXml(filePath)}</file>`);
      }
      lines.push('    </files>');
    }
    if (boundaries) {
      lines.push(`    <boundaries>${escapeXml(boundaries)}</boundaries>`);
    }
    lines.push('  </scope>');
    lines.push('');
  }

  // Action
  lines.push('  <action>');
  lines.push(`    ${escapeXml(action)}`);
  lines.push('  </action>');
  lines.push('');

  // Verification
  if (checks.length > 0) {
    lines.push('  <verify>');
    for (const check of checks) {
      const checkType = typeof check === 'string' ? 'manual' : check.type;
      const checkValue = typeof check === 'string' ? check : check.value;
      lines.push(`    <check type="${checkType}">${escapeXml(checkValue)}</check>`);
    }
    lines.push('  </verify>');
    lines.push('');
  }

  // Done
  lines.push('  <done>');
  lines.push(`    ${escapeXml(done)}`);
  lines.push('  </done>');
  lines.push('');

  // Tracking
  lines.push('  <tracking>');
  lines.push(`    <goodflows>${trackGoodflows}</goodflows>`);
  lines.push('  </tracking>');

  lines.push('</task>');

  return lines.join('\n');
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default {
  parseTask,
  validateTask,
  generateVerificationScript,
  generateTaskPrompt,
  createTaskXml,
  TASK_TYPES,
  CHECK_TYPES,
};
