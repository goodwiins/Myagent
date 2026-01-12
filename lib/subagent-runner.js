/**
 * GoodFlows Subagent Runner
 *
 * Invokes subagents with isolated context for fresh execution.
 * Manages handoff between subtasks and captures results.
 *
 * @module goodflows/lib/subagent-runner
 */

// SessionContextManager imported for future agent isolation
import { SessionContextManager as _SessionContextManager } from './session-context.js';
void _SessionContextManager;

/**
 * Execution modes
 */
export const EXECUTION_MODE = {
  SIMULATED: 'simulated',  // For testing - returns mock results
  AGENT: 'agent',          // Real agent execution via Claude
};

/**
 * Default timeout for subtask execution (5 minutes)
 */
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run a subtask in a fresh subagent context
 *
 * This is the core function that ensures each subtask gets:
 * 1. Fresh context (no accumulated garbage)
 * 2. Access to shared session state
 * 3. Proper handoff of prior results
 *
 * @param {object} subtask - Subtask to execute
 * @param {string} sessionId - Parent session ID
 * @param {object} options - Execution options
 * @returns {Promise<object>} Execution result
 */
export async function runSubagent(subtask, sessionId, options = {}) {
  const mode = options.mode || EXECUTION_MODE.SIMULATED;
  const _timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  const sessionManager = options.sessionManager || null;
  void _timeout; // Will be used for real agent execution

  // Create execution context
  const context = {
    subtaskId: subtask.id,
    planId: subtask.planId,
    sessionId,
    description: subtask.description,
    agentType: subtask.agentType,
    input: subtask.input,
    priorResults: subtask.context?.priorResults || {},
    startedAt: new Date().toISOString(),
  };

  // Log start
  if (sessionManager) {
    sessionManager.addEvent('subagent_started', {
      subtaskId: subtask.id,
      agentType: subtask.agentType,
      description: subtask.description.slice(0, 100),
    });
  }

  try {
    let result;

    switch (mode) {
      case EXECUTION_MODE.SIMULATED:
        result = await runSimulated(subtask, context, options);
        break;

      case EXECUTION_MODE.AGENT:
        result = await runWithAgent(subtask, context, options);
        break;

      default:
        throw new Error(`Unknown execution mode: ${mode}`);
    }

    // Update session with results
    if (sessionManager) {
      // Track any files modified
      if (result.filesModified?.length > 0) {
        for (const file of result.filesModified) {
          sessionManager.trackFile(file, 'modified', { subtaskId: subtask.id });
        }
      }

      // Track any issues created/fixed
      if (result.issuesCreated?.length > 0) {
        sessionManager.trackIssues(result.issuesCreated, 'created');
      }
      if (result.issuesFixed?.length > 0) {
        sessionManager.trackIssues(result.issuesFixed, 'fixed');
      }

      sessionManager.addEvent('subagent_completed', {
        subtaskId: subtask.id,
        status: result.status,
        duration: Date.now() - new Date(context.startedAt).getTime(),
      });
    }

    return {
      status: 'success',
      subtaskId: subtask.id,
      ...result,
      context: {
        executionMode: mode,
        startedAt: context.startedAt,
        completedAt: new Date().toISOString(),
      },
    };

  } catch (error) {
    // Log failure
    if (sessionManager) {
      sessionManager.addEvent('subagent_failed', {
        subtaskId: subtask.id,
        error: error.message,
      });
      sessionManager.recordError(error, { subtaskId: subtask.id });
    }

    return {
      status: 'error',
      subtaskId: subtask.id,
      error: {
        message: error.message,
        code: error.code || 'EXECUTION_ERROR',
        retryable: isRetryable(error),
      },
      context: {
        executionMode: mode,
        startedAt: context.startedAt,
        failedAt: new Date().toISOString(),
      },
    };
  }
}

/**
 * Run subtask in simulated mode (for testing)
 */
async function runSimulated(subtask, context, options = {}) {
  // Simulate some work
  const delay = options.simulatedDelay || 100;
  await sleep(delay);

  // Generate mock result based on agent type
  const result = generateMockResult(subtask, context);

  return result;
}

/**
 * Run subtask with a real Claude agent
 *
 * This creates an invocation that will be picked up by the
 * plan-orchestrator agent or executed directly via the SDK.
 *
 * IMPORTANT: If no executor is provided, this returns an invocation request
 * that MUST be executed by the calling code. The invocation includes
 * mandatory tracking instructions that the executing agent must follow.
 */
async function runWithAgent(subtask, context, options = {}) {
  // Build the prompt for the subagent (includes mandatory tracking instructions)
  const prompt = buildSubagentPrompt(subtask, context);

  // Check if we have a direct executor (SDK integration)
  if (options.executor) {
    const result = await options.executor(prompt, {
      agentType: subtask.agentType,
      sessionId: context.sessionId,
      timeout: options.timeout,
    });

    // Validate that tracking was performed
    const trackingValidation = validateTrackingCompliance(result);
    if (!trackingValidation.compliant) {
      console.warn(`[GoodFlows] Tracking validation warning for subtask ${subtask.id}:`, trackingValidation.warnings);
      result._trackingWarnings = trackingValidation.warnings;
    }

    return result;
  }

  // Otherwise, return an invocation request
  // The calling code (plan-orchestrator) MUST handle execution via Task tool
  return {
    status: 'invocation_created',
    requiresExecution: true,
    invocation: {
      agentType: subtask.agentType,
      prompt,
      sessionId: context.sessionId,
      subtaskId: subtask.id,
      planId: context.planId,
      input: subtask.input,
      // Explicit tracking requirements
      trackingRequired: true,
      requiredTools: [
        'goodflows_start_work',
        'goodflows_track_file',
        'goodflows_track_issue',
        'goodflows_complete_work',
      ],
    },
    message: 'IMPORTANT: Execute this invocation via Task tool with the provided prompt. ' +
             'The agent MUST call GoodFlows tracking tools (goodflows_start_work, goodflows_track_*, goodflows_complete_work).',
    executionHint: `Use Task tool with subagent_type="${subtask.agentType || 'general'}" and pass the prompt.`,
  };
}

/**
 * Validate that a result includes evidence of tracking compliance
 *
 * @param {object} result - The result from agent execution
 * @returns {object} Validation result with compliant flag and warnings
 */
function validateTrackingCompliance(result) {
  const warnings = [];

  // Check for evidence of tracking
  const hasFilesTracked = result.filesModified?.length > 0 ||
                          result.filesCreated?.length > 0 ||
                          result.tracking?.files;

  const hasIssuesTracked = result.issuesCreated?.length > 0 ||
                           result.issuesFixed?.length > 0 ||
                           result.tracking?.issues;

  const hasWorkUnit = result.workUnit || result.tracking?.workCompleted;

  // If the result claims success but has no tracking evidence, warn
  if (result.status === 'success') {
    if (!hasFilesTracked && !hasIssuesTracked) {
      warnings.push('No files or issues tracked. Did the agent use GoodFlows tracking tools?');
    }
    if (!hasWorkUnit) {
      warnings.push('No work unit completion detected. Agent may not have called goodflows_complete_work.');
    }
  }

  // If there are modified files but they weren't tracked
  if (result.output?.includes('Edit') || result.output?.includes('Write')) {
    if (!hasFilesTracked) {
      warnings.push('Output suggests file modifications but no tracking recorded.');
    }
  }

  return {
    compliant: warnings.length === 0,
    warnings,
    evidence: {
      filesTracked: hasFilesTracked,
      issuesTracked: hasIssuesTracked,
      workUnitCompleted: hasWorkUnit,
    },
  };
}

/**
 * Build a prompt for the subagent
 */
function buildSubagentPrompt(subtask, context) {
  const parts = [
    `## Task`,
    ``,
    subtask.description,
    ``,
  ];

  // Add prior results if available
  if (Object.keys(context.priorResults).length > 0) {
    parts.push(`## Prior Results`);
    parts.push(``);
    for (const [depId, result] of Object.entries(context.priorResults)) {
      parts.push(`### From ${depId}`);
      parts.push(``);
      if (typeof result === 'object') {
        parts.push('```json');
        parts.push(JSON.stringify(result, null, 2).slice(0, 1000));
        parts.push('```');
      } else {
        parts.push(String(result).slice(0, 1000));
      }
      parts.push(``);
    }
  }

  // Add specific instructions based on agent type
  if (subtask.agentType) {
    parts.push(`## Agent Type`);
    parts.push(``);
    parts.push(`Execute as: ${subtask.agentType}`);
    parts.push(``);
  }

  // Add session context
  parts.push(`## Session Context`);
  parts.push(``);
  parts.push(`- Session ID: ${context.sessionId}`);
  parts.push(`- Plan ID: ${context.planId}`);
  parts.push(`- Subtask ID: ${context.subtaskId}`);
  parts.push(``);

  // MANDATORY: Add GoodFlows tracking requirements
  parts.push(`## MANDATORY: GoodFlows Tracking Requirements`);
  parts.push(``);
  parts.push(`**CRITICAL: You MUST use GoodFlows tracking tools before completing this task.**`);
  parts.push(`DO NOT exit or return results without calling these tools first.`);
  parts.push(``);
  parts.push(`### Required Steps:`);
  parts.push(``);
  parts.push(`1. **Start Work Unit** (FIRST THING):`);
  parts.push(`   \`\`\`javascript`);
  parts.push(`   goodflows_start_work({`);
  parts.push(`     type: "${subtask.agentType || 'general'}",`);
  parts.push(`     sessionId: "${context.sessionId}",`);
  parts.push(`     subtaskId: "${context.subtaskId}"`);
  parts.push(`   })`);
  parts.push(`   \`\`\``);
  parts.push(``);
  parts.push(`2. **Track ALL File Operations** (as you work):`);
  parts.push(`   - For EVERY file you create: \`goodflows_track_file({ path: "...", action: "created" })\``);
  parts.push(`   - For EVERY file you modify: \`goodflows_track_file({ path: "...", action: "modified" })\``);
  parts.push(`   - For EVERY file you delete: \`goodflows_track_file({ path: "...", action: "deleted" })\``);
  parts.push(``);
  parts.push(`3. **Track ALL Issue Operations** (if applicable):`);
  parts.push(`   - For EVERY issue created: \`goodflows_track_issue({ issueId: "...", action: "created" })\``);
  parts.push(`   - For EVERY issue fixed: \`goodflows_track_issue({ issueId: "...", action: "fixed" })\``);
  parts.push(`   - For EVERY issue skipped: \`goodflows_track_issue({ issueId: "...", action: "skipped", reason: "..." })\``);
  parts.push(``);
  parts.push(`4. **Complete Work Unit** (LAST THING, BEFORE any return/exit):`);
  parts.push(`   \`\`\`javascript`);
  parts.push(`   goodflows_complete_work({`);
  parts.push(`     sessionId: "${context.sessionId}",`);
  parts.push(`     success: true/false,`);
  parts.push(`     // Include summary of what was done`);
  parts.push(`   })`);
  parts.push(`   \`\`\``);
  parts.push(``);
  parts.push(`### FAILURE TO TRACK = INCOMPLETE TASK`);
  parts.push(``);
  parts.push(`If you do not call these GoodFlows tools, your work will NOT be recorded and`);
  parts.push(`the orchestrator will have no visibility into what was accomplished.`);
  parts.push(``);
  parts.push(`---`);
  parts.push(``);

  // Add completion instructions
  parts.push(`## Final Report Format`);
  parts.push(``);
  parts.push(`After completing tracking, provide a summary:`);
  parts.push(`1. Status (success/partial/failed)`);
  parts.push(`2. Files modified (list from your tracking)`);
  parts.push(`3. Issues created/fixed (list from your tracking)`);
  parts.push(`4. Key results or findings`);
  parts.push(``);

  return parts.join('\n');
}

/**
 * Generate mock result for testing
 */
function generateMockResult(subtask, _context) {
  const agentType = subtask.agentType || 'general';

  switch (agentType) {
    case 'review-orchestrator':
      return {
        status: 'success',
        type: 'review',
        findings: [
          { type: 'potential_issue', file: 'src/example.js', description: 'Mock finding 1' },
          { type: 'refactor_suggestion', file: 'src/utils.js', description: 'Mock finding 2' },
        ],
        summary: {
          totalFindings: 2,
          critical: 0,
          high: 1,
          medium: 1,
          low: 0,
        },
      };

    case 'issue-creator':
      return {
        status: 'success',
        type: 'issues',
        issuesCreated: ['GOO-100', 'GOO-101'],
        duplicatesSkipped: 0,
        summary: {
          created: 2,
          skipped: 0,
        },
      };

    case 'coderabbit-auto-fixer':
      return {
        status: 'success',
        type: 'fix',
        filesModified: ['src/example.js'],
        issuesFixed: ['GOO-100'],
        patternsUsed: ['null-check'],
        verified: true,
        summary: {
          fixed: 1,
          failed: 0,
          skipped: 0,
        },
      };

    default:
      return {
        status: 'success',
        type: 'general',
        output: `Completed: ${subtask.description.slice(0, 50)}`,
        summary: {
          completed: true,
        },
      };
  }
}

/**
 * Determine if an error is retryable
 */
function isRetryable(error) {
  const retryableCodes = [
    'TIMEOUT',
    'RATE_LIMITED',
    'SERVICE_UNAVAILABLE',
    'NETWORK_ERROR',
  ];

  if (error.code && retryableCodes.includes(error.code)) {
    return true;
  }

  const retryableMessages = [
    /timeout/i,
    /rate limit/i,
    /too many requests/i,
    /service unavailable/i,
    /network/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
  ];

  return retryableMessages.some(pattern => pattern.test(error.message));
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a subagent runner with preset options
 */
export function createSubagentRunner(options = {}) {
  return {
    run: (subtask, sessionId, runOptions = {}) =>
      runSubagent(subtask, sessionId, { ...options, ...runOptions }),

    setMode: (mode) => {
      options.mode = mode;
    },

    setTimeout: (timeout) => {
      options.timeout = timeout;
    },
  };
}

/**
 * Batch run multiple subtasks
 *
 * @param {object[]} subtasks - Array of subtasks
 * @param {string} sessionId - Session ID
 * @param {object} options - Options
 * @returns {Promise<object[]>} Array of results
 */
export async function runSubagentBatch(subtasks, sessionId, options = {}) {
  const concurrency = options.concurrency || 1;
  const results = [];

  // Process in batches based on concurrency
  for (let i = 0; i < subtasks.length; i += concurrency) {
    const batch = subtasks.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(subtask => runSubagent(subtask, sessionId, options)),
    );

    results.push(...batchResults);
  }

  return results;
}

/**
 * Create a mock executor for testing
 */
export function createMockExecutor(responses = {}) {
  return async (prompt, options) => {
    const agentType = options.agentType || 'general';

    if (responses[agentType]) {
      return responses[agentType];
    }

    return {
      status: 'success',
      output: `Mock response for ${agentType}`,
      prompt: prompt.slice(0, 100),
    };
  };
}

export default {
  runSubagent,
  runSubagentBatch,
  createSubagentRunner,
  createMockExecutor,
  buildSubagentPrompt,
  validateTrackingCompliance,
  EXECUTION_MODE,
  DEFAULT_TIMEOUT_MS,
};
