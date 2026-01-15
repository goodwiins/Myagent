/**
 * GoodFlows XML Task Parser
 *
 * Parses XML-formatted task definitions from PLAN.md
 * Extracts structured information for precise task execution.
 *
 * Supports both single-task (legacy) and multi-task (GSD) formats.
 *
 * @module goodflows/lib/xml-task-parser
 */

/**
 * Task types (legacy)
 */
export const TASK_TYPES = {
  IMPLEMENTATION: 'implementation',
  FIX: 'fix',
  REFACTOR: 'refactor',
  REVIEW: 'review',
  AUTO: 'auto',
};

/**
 * GSD Task types (multi-task plans)
 */
export const GSD_TASK_TYPES = {
  AUTO: 'auto',
  CHECKPOINT_HUMAN_VERIFY: 'checkpoint:human-verify',
  CHECKPOINT_HUMAN_ACTION: 'checkpoint:human-action',
  CHECKPOINT_DECISION: 'checkpoint:decision',
};

/**
 * Gate values for checkpoints
 */
export const GATE_VALUES = {
  BLOCKING: 'blocking',
  OPTIONAL: 'optional',
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
 * Parse an XML task definition (single task - legacy format)
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
 * Parse a multi-task PLAN.md (GSD format)
 * @param {string} content - Full PLAN.md content
 * @returns {object} Parsed plan object with metadata and tasks
 */
export function parseMultiTaskPlan(content) {
  if (!content || typeof content !== 'string') {
    return { valid: false, error: 'No content provided' };
  }

  const result = {
    valid: true,
    metadata: {},
    objective: null,
    context: {
      projectFile: null,
      stateFile: null,
      sourceFiles: [],
    },
    tasks: [],
    verification: [],
    successCriteria: [],
    executionStrategy: 'autonomous',
    hasCheckpoints: false,
    checkpointTypes: [],
  };

  // Parse YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const lines = frontmatterMatch[1].split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        // Handle arrays
        if (value.startsWith('[') && value.endsWith(']')) {
          try {
            result.metadata[key] = JSON.parse(value);
          } catch {
            result.metadata[key] = value;
          }
        } else {
          result.metadata[key] = value;
        }
      }
    }
  }

  // Parse objective
  const objectiveMatch = content.match(/<objective>([\s\S]*?)<\/objective>/i);
  if (objectiveMatch) {
    const objContent = objectiveMatch[1].trim();
    const purposeMatch = objContent.match(/Purpose:\s*(.+)/i);
    const outputMatch = objContent.match(/Output:\s*(.+)/i);

    result.objective = {
      description: objContent.split(/Purpose:|Output:/i)[0].trim(),
      purpose: purposeMatch ? purposeMatch[1].trim() : null,
      output: outputMatch ? outputMatch[1].trim() : null,
    };
  }

  // Parse context references
  const contextMatch = content.match(/<context>([\s\S]*?)<\/context>/i);
  if (contextMatch) {
    const contextContent = contextMatch[1];
    const fileRefs = contextContent.match(/@[^\s\n]+/g) || [];
    for (const ref of fileRefs) {
      const path = ref.replace('@', '');
      if (path.includes('PROJECT')) {
        result.context.projectFile = path;
      } else if (path.includes('STATE')) {
        result.context.stateFile = path;
      } else {
        result.context.sourceFiles.push(path);
      }
    }
  }

  // Parse all tasks
  const taskRegex = /<task[^>]*>([\s\S]*?)<\/task>/gi;
  const taskAttrRegex = /<task([^>]*)>/gi;
  let taskMatch;
  let attrMatch;

  // Reset regex
  taskRegex.lastIndex = 0;
  taskAttrRegex.lastIndex = 0;

  const taskContents = [];
  while ((taskMatch = taskRegex.exec(content)) !== null) {
    taskContents.push(taskMatch[0]);
  }

  for (const taskXml of taskContents) {
    const attrPart = taskXml.match(/<task([^>]*)>/)?.[1] || '';
    const contentPart = taskXml.match(/<task[^>]*>([\s\S]*?)<\/task>/)?.[1] || '';

    // Parse attributes
    const typeMatch = attrPart.match(/type=["']([^"']+)["']/);
    const idMatch = attrPart.match(/id=["']([^"']+)["']/);
    const gateMatch = attrPart.match(/gate=["']([^"']+)["']/);

    const taskType = typeMatch ? typeMatch[1] : GSD_TASK_TYPES.AUTO;
    const taskId = idMatch ? idMatch[1] : `task-${result.tasks.length + 1}`;

    const task = {
      id: taskId,
      type: taskType,
    };

    // Check if checkpoint
    if (taskType.startsWith('checkpoint:')) {
      result.hasCheckpoints = true;
      if (!result.checkpointTypes.includes(taskType)) {
        result.checkpointTypes.push(taskType);
      }

      task.gate = gateMatch ? gateMatch[1] : GATE_VALUES.BLOCKING;
      task.whatBuilt = extractElement(contentPart, 'what-built');
      task.howToVerify = extractElement(contentPart, 'how-to-verify');
      task.resumeSignal = extractElement(contentPart, 'resume-signal');
    } else {
      // Regular auto task
      task.name = extractElement(contentPart, 'name');
      task.files = extractElement(contentPart, 'files');
      task.action = extractElement(contentPart, 'action');
      task.verify = extractElement(contentPart, 'verify');
      task.done = extractElement(contentPart, 'done');
    }

    result.tasks.push(task);
  }

  // Determine execution strategy
  result.executionStrategy = result.hasCheckpoints ? 'segmented' : 'autonomous';

  // Parse verification checklist
  const verificationMatch = content.match(/<verification>([\s\S]*?)<\/verification>/i);
  if (verificationMatch) {
    const checks = verificationMatch[1].match(/- \[[ x]\] .+/g) || [];
    result.verification = checks.map(c => c.replace(/- \[[ x]\] /, '').trim());
  }

  // Parse success criteria
  const criteriaMatch = content.match(/<success_criteria>([\s\S]*?)<\/success_criteria>/i);
  if (criteriaMatch) {
    const criteria = criteriaMatch[1].match(/- .+/g) || [];
    result.successCriteria = criteria.map(c => c.replace(/^- /, '').trim());
  }

  // Validate
  if (result.tasks.length === 0) {
    result.valid = false;
    result.error = 'No tasks found in plan';
  }

  return result;
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
 * Create a task XML from structured input (legacy single-task format)
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
 * Create a multi-task PLAN.md (GSD format)
 * @param {object} planData - Plan data
 * @param {object} planData.metadata - YAML frontmatter fields
 * @param {object} planData.objective - Plan objective (description, purpose, output)
 * @param {string[]} planData.contextFiles - Context file references
 * @param {object[]} planData.tasks - Array of task definitions
 * @param {string[]} planData.verification - Verification checklist items
 * @param {string[]} planData.successCriteria - Success criteria items
 * @returns {string} Full PLAN.md content
 */
export function createMultiTaskPlanXml(planData) {
  const {
    metadata = {},
    objective = {},
    contextFiles = [],
    tasks = [],
    verification = [],
    successCriteria = [],
  } = planData;

  const lines = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`phase: ${metadata.phase || '01-foundation'}`);
  lines.push(`plan: ${metadata.plan || '01'}`);
  lines.push(`type: ${metadata.type || 'execute'}`);
  lines.push(`depends_on: ${JSON.stringify(metadata.dependsOn || [])}`);
  lines.push(`files_modified: ${JSON.stringify(metadata.filesModified || [])}`);
  lines.push('---');
  lines.push('');

  // Objective
  lines.push('<objective>');
  lines.push(objective.description || '[What this plan accomplishes]');
  lines.push('');
  lines.push(`Purpose: ${objective.purpose || '[Why this matters]'}`);
  lines.push(`Output: ${objective.output || '[What artifacts will be created]'}`);
  lines.push('</objective>');
  lines.push('');

  // Execution context
  lines.push('<execution_context>');
  lines.push('@.goodflows/workflows/execute-plan.md');
  lines.push('@.goodflows/templates/summary.md');
  lines.push('</execution_context>');
  lines.push('');

  // Context files
  lines.push('<context>');
  lines.push('@.goodflows/PROJECT.md');
  lines.push('@.goodflows/ROADMAP.md');
  lines.push('@.goodflows/STATE.md');
  for (const file of contextFiles) {
    lines.push(`@${file}`);
  }
  lines.push('</context>');
  lines.push('');

  // Tasks
  lines.push('<tasks>');
  lines.push('');

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const taskId = task.id || `task-${i + 1}`;
    const taskType = task.type || GSD_TASK_TYPES.AUTO;

    if (taskType.startsWith('checkpoint:')) {
      // Checkpoint task
      const gate = task.gate || GATE_VALUES.BLOCKING;
      lines.push(`<task type="${taskType}" id="${taskId}" gate="${gate}">`);
      lines.push(`  <what-built>${escapeXml(task.whatBuilt || '[What was just built]')}</what-built>`);
      lines.push('  <how-to-verify>');
      lines.push(`    ${escapeXml(task.howToVerify || '1. [Verification steps]')}`);
      lines.push('  </how-to-verify>');
      lines.push(`  <resume-signal>${escapeXml(task.resumeSignal || 'Type "approved" to continue')}</resume-signal>`);
      lines.push('</task>');
    } else {
      // Auto task
      lines.push(`<task type="${taskType}" id="${taskId}">`);
      lines.push(`  <name>${escapeXml(task.name || `Task ${i + 1}`)}</name>`);
      lines.push(`  <files>${escapeXml(Array.isArray(task.files) ? task.files.join(', ') : (task.files || ''))}</files>`);
      lines.push('  <action>');
      lines.push(`    ${escapeXml(task.action || '[Implementation instructions]')}`);
      lines.push('  </action>');
      lines.push(`  <verify>${escapeXml(task.verify || '[Verification command]')}</verify>`);
      lines.push(`  <done>${escapeXml(task.done || '[Acceptance criteria]')}</done>`);
      lines.push('</task>');
    }
    lines.push('');
  }

  lines.push('</tasks>');
  lines.push('');

  // Verification
  lines.push('<verification>');
  lines.push('Before declaring complete:');
  if (verification.length > 0) {
    for (const check of verification) {
      lines.push(`- [ ] ${check}`);
    }
  } else {
    for (let i = 0; i < tasks.length; i++) {
      lines.push(`- [ ] Task ${i + 1} verification passed`);
    }
  }
  lines.push('</verification>');
  lines.push('');

  // Success criteria
  lines.push('<success_criteria>');
  if (successCriteria.length > 0) {
    for (const criterion of successCriteria) {
      lines.push(`- ${criterion}`);
    }
  } else {
    lines.push('- All tasks completed');
    lines.push('- All verification checks pass');
  }
  lines.push('</success_criteria>');

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
  parseMultiTaskPlan,
  validateTask,
  generateVerificationScript,
  generateTaskPrompt,
  createTaskXml,
  createMultiTaskPlanXml,
  TASK_TYPES,
  GSD_TASK_TYPES,
  CHECK_TYPES,
  GATE_VALUES,
};
