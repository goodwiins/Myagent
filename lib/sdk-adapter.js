/**
 * GoodFlows SDK Adapter
 *
 * Bridges the Claude Agent SDK with GoodFlows' unique features:
 * - Priority Queue (critical security first)
 * - Deduplication (trigram similarity)
 * - Pattern Tracking (fix confidence)
 * - Session Context (checkpoint/rollback)
 *
 * @module goodflows/lib/sdk-adapter
 */

import { PriorityQueue, PRIORITY, TYPE_TO_PRIORITY } from './priority-queue.js';
import { SessionContextManager } from './session-context.js';
import { ContextStore } from './context-store.js';
import { PatternTracker } from './pattern-tracker.js';
import { findSimilar } from './context-index.js';

/**
 * GoodFlows Agent Definitions for Claude Agent SDK
 *
 * These can be passed directly to the SDK's `agents` parameter:
 *
 * ```javascript
 * import { query } from "@anthropic-ai/claude-agent-sdk";
 * import { GOODFLOWS_AGENTS } from "goodflows/lib/sdk-adapter";
 *
 * for await (const message of query({
 *   prompt: "Run full code review",
 *   options: { agents: GOODFLOWS_AGENTS }
 * })) {
 *   console.log(message);
 * }
 * ```
 */
/**
 * Linear MCP Tool Names
 *
 * These tools are exposed by the linear-mcp-server.
 * The naming follows the pattern: {serverName}__{toolName}
 */
export const LINEAR_MCP_TOOLS = [
  'linear__list_teams',
  'linear__create_issue',
  'linear__update_issue',
  'linear__get_issue',
  'linear__list_issue_labels',
  'linear__create_comment',
  'linear__search_issues',
];

/**
 * Serena MCP Tool Names
 *
 * These tools are exposed by the serena-mcp-server for code analysis.
 * The naming follows the pattern: {serverName}__{toolName}
 */
export const SERENA_MCP_TOOLS = [
  'serena__find_symbol',
  'serena__find_referencing_symbols',
  'serena__get_symbols_overview',
  'serena__replace_symbol_body',
  'serena__replace_content',
  'serena__read_file',
  'serena__read_memory',
  'serena__write_memory',
  'serena__search_for_pattern',
  'serena__list_dir',
];

/**
 * GoodFlows Agent Definitions for Claude Agent SDK
 *
 * These can be passed directly to the SDK's `agents` parameter.
 * Linear MCP tools are included - ensure mcpServers.linear is configured.
 */
export const GOODFLOWS_AGENTS = {
  'review-orchestrator': {
    description: `Code review orchestrator. Use when: running CodeRabbit reviews,
      creating Linear issues from findings, coordinating the review-to-fix workflow.
      Triggers: "review and track", "run coderabbit", "full code review", "create issues"`,
    prompt: `You are a Code Review Orchestrator for the GoodFlows system.

PRE-REVIEW (check existing findings first):
1. Run: goodflows context query --status open (see what's already tracked)
2. For each file to review: goodflows context query --file <path> (avoid duplicates)

REVIEW WORKFLOW:
3. Run CodeRabbit CLI: \`coderabbit review --type uncommitted --plain\`
4. Use serena__get_symbols_overview to understand code structure
5. Parse findings and categorize by priority (P1 critical → P4 docs)
6. Use linear__list_teams to get the team ID
7. Use linear__create_issue to create issues for NEW findings only
8. Use serena__write_memory to store in .serena/memories/coderabbit_findings.md
9. Optionally delegate to auto-fixer agent for safe fixes

POST-REVIEW:
10. Run: goodflows context export (generate markdown report)
11. Report summary with issue IDs and fix status

Priority order (always process P1 first):
- P1 (Urgent): critical_security → labels: security, critical
- P2 (High): potential_issue → labels: bug
- P3 (Normal): refactor_suggestion, performance → labels: improvement, performance
- P4 (Low): documentation → labels: docs

Title prefixes: [SECURITY], fix:, refactor:, perf:, docs:

IMPORTANT:
- ALWAYS run goodflows context query before creating issues (avoid duplicates!)
- Use Linear MCP tools (linear__create_issue) to create real issues
- Use Serena MCP tools (serena__*) for code analysis and memory storage
- Run goodflows context export after workflow completes`,
    tools: [
      'Bash',
      'Read',
      'Glob',
      'Grep',
      'Task',
      ...LINEAR_MCP_TOOLS,
      ...SERENA_MCP_TOOLS,
    ],
    model: 'sonnet',
  },

  'issue-creator': {
    description: `Linear issue creation specialist. Use when: creating Linear issues
      from code review findings, tracking bugs, managing issue labels and priorities.
      Triggers: "create Linear issues", "track in Linear", "create issues for"`,
    prompt: `You are a Linear Issue Creation Specialist for GoodFlows.

CRITICAL: You MUST use the Linear MCP tools to create real issues, not just text files.

Your workflow:
1. Call linear__list_teams to get the team ID (usually the first team)
2. Call linear__list_issue_labels to get available labels
3. For each finding, call linear__create_issue with:
   - teamId: from step 1
   - title: with appropriate prefix ([SECURITY], fix:, refactor:, perf:, docs:)
   - description: formatted markdown with file, lines, details, proposed fix
   - priority: 1-4 based on type
   - labelIds: matching the finding type

Label mapping:
- critical_security → labels: security, critical | priority: 1
- potential_issue → labels: bug | priority: 2
- refactor_suggestion → labels: improvement | priority: 3
- performance → labels: performance | priority: 3
- documentation → labels: docs | priority: 4

Before creating, use linear__search_issues to check for duplicates with similar title/description.

Return structured output with actual Linear issue IDs:
{ created: [{ id: "GOO-XX", url: "https://...", title: "..." }], duplicatesSkipped: number }`,
    tools: [
      'Read',
      ...LINEAR_MCP_TOOLS,
    ],
    model: 'haiku',
  },

  'coderabbit-auto-fixer': {
    description: `Automated code fixer. Use when: applying CodeRabbit-recommended fixes,
      fixing specific Linear issues, verifying fixes pass tests.
      Triggers: "/fix-linear GOO-XX", "fix the issue", "apply the fix"`,
    prompt: `You are an Automated Code Fixer for GoodFlows.

MANDATORY PRE-FIX STEPS (never skip):
1. Use serena__read_memory to check auto_fix_patterns.md for existing patterns
2. Read .goodflows/context/index.json to check if issue already fixed
3. Use linear__get_issue to read the issue details from Linear

FIX WORKFLOW:
4. Use serena__find_symbol to locate the affected code
5. Use serena__read_file to read the affected file with full context
6. Understand the proposed fix and verify it makes sense
7. Apply the fix using serena__replace_symbol_body or serena__replace_content
8. Run verification: linters, type checks, tests
9. If verification fails, revert and mark for manual review

MANDATORY POST-FIX STEPS (never skip on success):
10. Use serena__write_memory to update auto_fix_patterns.md with the fix pattern
11. Update .goodflows/context/index.json with: byIssue[issueId], patterns[patternId]
12. Use linear__update_issue to update issue status to Done
13. Use linear__create_comment with pattern ID, confidence, and verification results

Safety rules:
- Always read file before editing
- Create checkpoint before risky changes
- Revert immediately if tests fail
- Never skip verification for security fixes

CRITICAL: You MUST update both Serena memory AND GoodFlows context index after every successful fix.

Return: { fixed: [{ issueId, file, pattern, verified }], failed: [{ issueId, reason }], errors: [] }`,
    tools: [
      'Read',
      'Edit',
      'Bash',
      ...LINEAR_MCP_TOOLS,
      ...SERENA_MCP_TOOLS,
    ],
    model: 'opus',
  },
};

/**
 * GoodFlows Hooks for Claude Agent SDK
 *
 * Integrates GoodFlows features into the SDK's hook system:
 * - PreToolUse: Priority queue enforcement, deduplication
 * - PostToolUse: Pattern tracking, context store updates
 * - SubagentStop: Session context sync
 */
export function createGoodFlowsHooks(options = {}) {
  // Initialize GoodFlows components
  const contextStore = options.contextStore || new ContextStore();
  const patternTracker = options.patternTracker || new PatternTracker();
  const sessionManager = options.sessionManager || new SessionContextManager();
  const _priorityQueue = options.priorityQueue || new PriorityQueue();
  void _priorityQueue; // Reserved for future queue enforcement

  // Track current session
  let sessionId = null;

  return {
    /**
     * PreToolUse hooks - run before tool execution
     */
    PreToolUse: [
      // Priority Queue enforcement
      {
        matcher: 'Task',  // Intercept subagent invocations
        hooks: [
          async (input, _toolUseId, _context) => {
            const taskInput = input.tool_input || {};

            // If invoking issue-creator with findings, enforce priority order
            if (taskInput.subagent_type === 'issue-creator') {
              // Extract findings using robust extraction (handles structured input + prompt)
              const { findings, raw } = extractFindings(taskInput);

              if (findings.length > 0) {
                // Sort by priority (critical first)
                const sorted = [...findings].sort((a, b) => {
                  const pA = TYPE_TO_PRIORITY[a.type] || PRIORITY.LOW;
                  const pB = TYPE_TO_PRIORITY[b.type] || PRIORITY.LOW;
                  return pA - pB;
                });

                // Check if already sorted
                const alreadySorted = findings.every((f, i) => f === sorted[i]);
                if (alreadySorted) {
                  return {};
                }

                sessionManager.addEvent('priority_queue_sorted', {
                  original: findings.length,
                  criticalFirst: sorted[0]?.type,
                });

                // Update input with sorted findings
                // Prefer structured input if available
                if (taskInput.findings) {
                  return {
                    hookSpecificOutput: {
                      hookEventName: input.hook_event_name,
                      permissionDecision: 'allow',
                      updatedInput: {
                        ...taskInput,
                        findings: sorted,
                      },
                    },
                  };
                }

                // Fall back to prompt replacement
                if (taskInput.prompt && raw) {
                  const updatedPrompt = replaceFindingsInPrompt(taskInput.prompt, raw, sorted);

                  return {
                    hookSpecificOutput: {
                      hookEventName: input.hook_event_name,
                      permissionDecision: 'allow',
                      updatedInput: {
                        ...taskInput,
                        prompt: updatedPrompt,
                      },
                    },
                  };
                }
              }
            }
            return {};
          },
        ],
      },

      // Deduplication check
      {
        matcher: 'Task',
        hooks: [
          async (input, _toolUseId, _context) => {
            const taskInput = input.tool_input || {};

            // Check for duplicate findings before issue creation
            if (taskInput.subagent_type === 'issue-creator') {
              // Extract findings using robust extraction
              const { findings, raw } = extractFindings(taskInput);

              if (findings.length === 0) {
                return {};
              }

              const uniqueFindings = [];
              let duplicatesSkipped = 0;

              for (const finding of findings) {
                // Check if already exists in context store
                if (contextStore.exists(finding)) {
                  duplicatesSkipped++;
                  sessionManager.addEvent('duplicate_skipped', {
                    file: finding.file,
                    type: finding.type,
                  });
                  continue;
                }

                // Check for similar findings (fuzzy match)
                const similar = await checkSimilarity(finding, contextStore);
                if (similar) {
                  duplicatesSkipped++;
                  sessionManager.addEvent('similar_skipped', {
                    file: finding.file,
                    similarTo: similar.file,
                  });
                  continue;
                }

                uniqueFindings.push(finding);
              }

              if (duplicatesSkipped > 0) {
                sessionManager.set('deduplication.skipped', duplicatesSkipped);

                // All findings are duplicates - deny the tool call
                if (uniqueFindings.length === 0) {
                  return {
                    hookSpecificOutput: {
                      hookEventName: input.hook_event_name,
                      permissionDecision: 'deny',
                      permissionDecisionReason: `All ${duplicatesSkipped} findings are duplicates`,
                    },
                  };
                }

                // Update input with deduplicated findings
                // Prefer structured input if available
                if (taskInput.findings) {
                  return {
                    hookSpecificOutput: {
                      hookEventName: input.hook_event_name,
                      permissionDecision: 'allow',
                      updatedInput: {
                        ...taskInput,
                        findings: uniqueFindings,
                      },
                    },
                  };
                }

                // Fall back to prompt replacement
                if (taskInput.prompt && raw) {
                  const updatedPrompt = replaceFindingsInPrompt(taskInput.prompt, raw, uniqueFindings);

                  return {
                    hookSpecificOutput: {
                      hookEventName: input.hook_event_name,
                      permissionDecision: 'allow',
                      updatedInput: {
                        ...taskInput,
                        prompt: updatedPrompt,
                      },
                    },
                  };
                }
              }
            }
            return {};
          },
        ],
      },
    ],

    /**
     * PostToolUse hooks - run after tool execution
     */
    PostToolUse: [
      // Pattern tracking for fixes
      {
        matcher: 'Edit',
        hooks: [
          async (input, _toolUseId, _context) => {
            const filePath = input.tool_input?.file_path;
            const result = input.tool_response;

            // Track successful fix pattern
            if (result && !result.error) {
              const patternId = detectPattern(input.tool_input);
              if (patternId) {
                patternTracker.recordSuccess(patternId, {
                  file: filePath,
                  timestamp: new Date().toISOString(),
                });

                sessionManager.addEvent('pattern_success', {
                  patternId,
                  file: filePath,
                });
              }
            }

            return {};
          },
        ],
      },

      // Context store updates
      {
        matcher: 'Task',
        hooks: [
          async (input, _toolUseId, _context) => {
            const taskInput = input.tool_input || {};
            const result = input.tool_response;

            // Store created issues in context
            if (taskInput.subagent_type === 'issue-creator' && result) {
              const created = extractCreatedIssues(result);
              for (const issue of created) {
                contextStore.addFinding({
                  ...issue,
                  issueId: issue.id,
                  status: 'open',
                  createdAt: new Date().toISOString(),
                });
              }

              sessionManager.set('issues.created', created.map((i) => i.id));
              sessionManager.addEvent('issues_created', { count: created.length });
            }

            // Store fix results
            if (taskInput.subagent_type === 'coderabbit-auto-fixer' && result) {
              const fixed = extractFixedIssues(result);
              sessionManager.set('fixes.applied', fixed);
              sessionManager.addEvent('fixes_applied', { count: fixed.length });
            }

            return {};
          },
        ],
      },
    ],

    /**
     * SubagentStop hooks - run when subagent completes
     */
    SubagentStop: [
      {
        hooks: [
          async (input, toolUseId, _context) => {
            // Sync subagent results to session context
            sessionManager.addEvent('subagent_completed', {
              toolUseId,
              stopHookActive: input.stop_hook_active,
            });

            return {};
          },
        ],
      },
    ],

    /**
     * SessionStart hook - initialize GoodFlows components
     */
    SessionStart: [
      {
        hooks: [
          async (input, _toolUseId, _context) => {
            sessionId = sessionManager.start({
              trigger: 'agent-sdk',
              sdkSessionId: input.session_id,
            });

            return {
              additionalContext: `GoodFlows session started: ${sessionId}`,
            };
          },
        ],
      },
    ],

    /**
     * Stop hook - cleanup and save state
     */
    Stop: [
      {
        hooks: [
          async (_input, _toolUseId, _context) => {
            if (sessionId) {
              const summary = sessionManager.getSummary();
              sessionManager.complete(summary);
            }

            return {};
          },
        ],
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

/**
 * Extract findings from tool input or prompt text
 *
 * Extraction priority:
 * 1. Structured tool_input.findings (SDK best practice)
 * 2. JSON code block in prompt (```json ... ```)
 * 3. Balanced bracket JSON extraction from prompt
 *
 * @param {string|object} promptOrInput - The prompt text or tool input object
 * @returns {{ findings: object[], raw: string|null }} Findings array and raw JSON string
 */
function extractFindings(promptOrInput) {
  // Handle structured input (preferred SDK approach)
  if (typeof promptOrInput === 'object' && promptOrInput !== null) {
    if (Array.isArray(promptOrInput.findings)) {
      return {
        findings: promptOrInput.findings,
        raw: JSON.stringify(promptOrInput.findings),
      };
    }
    // Check nested in tool_input
    if (promptOrInput.tool_input?.findings) {
      return {
        findings: promptOrInput.tool_input.findings,
        raw: JSON.stringify(promptOrInput.tool_input.findings),
      };
    }
    // Fall through to prompt extraction if prompt field exists
    if (typeof promptOrInput.prompt === 'string') {
      promptOrInput = promptOrInput.prompt;
    } else {
      return { findings: [], raw: null };
    }
  }

  const prompt = String(promptOrInput || '');

  // Try JSON code block first (most reliable)
  const codeBlockMatch = prompt.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed)) {
        return { findings: parsed, raw: codeBlockMatch[1].trim() };
      }
      if (parsed.findings && Array.isArray(parsed.findings)) {
        return { findings: parsed.findings, raw: JSON.stringify(parsed.findings) };
      }
    } catch {
      // Invalid JSON in code block - try next extraction method
    }
  }

  // Use balanced bracket extraction for JSON arrays
  const jsonArray = extractBalancedJson(prompt, '[');
  if (jsonArray) {
    try {
      const parsed = JSON.parse(jsonArray);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Validate it looks like findings (has file or type property)
        if (parsed[0].file || parsed[0].type || parsed[0].description) {
          return { findings: parsed, raw: jsonArray };
        }
      }
    } catch {
      // Invalid JSON array - try object extraction
    }
  }

  // Try to find findings in an object
  const jsonObject = extractBalancedJson(prompt, '{');
  if (jsonObject) {
    try {
      const parsed = JSON.parse(jsonObject);
      if (parsed.findings && Array.isArray(parsed.findings)) {
        return { findings: parsed.findings, raw: JSON.stringify(parsed.findings) };
      }
    } catch {
      // Invalid JSON object - no valid findings found
    }
  }

  return { findings: [], raw: null };
}

/**
 * Extract a balanced JSON structure from text
 * Properly handles nested brackets and strings
 *
 * @param {string} text - Text to search
 * @param {string} openChar - Opening bracket: '[' or '{'
 * @returns {string|null} Extracted JSON string or null
 */
function extractBalancedJson(text, openChar) {
  const closeChar = openChar === '[' ? ']' : '}';
  const startIndex = text.indexOf(openChar);

  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === openChar) {
      depth++;
    } else if (char === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return null; // Unbalanced
}

/**
 * Replace findings in prompt text safely
 * Uses the raw JSON string from extraction to ensure exact match
 *
 * @param {string} prompt - Original prompt
 * @param {string} rawJson - Original JSON string to replace
 * @param {object[]} newFindings - New findings array
 * @returns {string} Updated prompt
 */
function replaceFindingsInPrompt(prompt, rawJson, newFindings) {
  if (!rawJson) return prompt;

  const newJson = JSON.stringify(newFindings);

  // Try direct replacement first
  if (prompt.includes(rawJson)) {
    return prompt.replace(rawJson, newJson);
  }

  // Try normalized comparison (handles whitespace differences)
  try {
    const normalizedOld = JSON.stringify(JSON.parse(rawJson));
    if (prompt.includes(normalizedOld)) {
      return prompt.replace(normalizedOld, newJson);
    }
  } catch {
    // Original JSON wasn't valid - use fallback methods
  }

  // Fallback: replace JSON code block content
  const codeBlockRegex = /(```(?:json)?\s*)([\s\S]*?)(```)/;
  if (codeBlockRegex.test(prompt)) {
    return prompt.replace(codeBlockRegex, `$1${newJson}$3`);
  }

  // Last resort: append note about updated findings
  return `${prompt}\n\n[Updated findings: ${newJson}]`;
}

/**
 * Check for similar findings using trigram similarity
 */
async function checkSimilarity(finding, contextStore) {
  const allFindings = contextStore.getAll ? contextStore.getAll() : [];
  const similar = findSimilar(finding, allFindings, { threshold: 0.85 });
  return similar.length > 0 ? similar[0] : null;
}

/**
 * Detect which fix pattern was used
 */
function detectPattern(editInput) {
  const content = editInput?.new_string || '';

  // Check for common patterns
  if (content.includes('process.env.') || content.includes('os.environ')) {
    return 'env-var-secret';
  }
  if (content.includes('!== null') || content.includes('!== undefined')) {
    return 'null-check';
  }
  if (content.includes('try {') || content.includes('try:')) {
    return 'try-catch-async';
  }
  if (content.includes('lock') || content.includes('mutex')) {
    return 'async-lock';
  }

  return null;
}

/**
 * Extract created issues from result
 */
function extractCreatedIssues(result) {
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      return parsed.created || [];
    } catch {
      return [];
    }
  }
  return result?.created || [];
}

/**
 * Extract fixed issues from result
 */
function extractFixedIssues(result) {
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      return parsed.fixed || [];
    } catch {
      return [];
    }
  }
  return result?.fixed || [];
}

// ─────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Create a complete GoodFlows configuration for the Claude Agent SDK
 *
 * @example
 * ```javascript
 * import { query } from "@anthropic-ai/claude-agent-sdk";
 * import { createGoodFlowsConfig } from "goodflows/lib/sdk-adapter";
 *
 * const config = createGoodFlowsConfig();
 *
 * for await (const message of query({
 *   prompt: "Run full code review and create issues",
 *   options: {
 *     allowedTools: ["Read", "Glob", "Grep", "Bash", "Edit", "Task"],
 *     agents: config.agents,
 *     hooks: config.hooks,
 *     mcpServers: config.mcpServers,
 *   }
 * })) {
 *   console.log(message);
 * }
 * ```
 */
export function createGoodFlowsConfig(options = {}) {
  const contextStore = options.contextStore || new ContextStore();
  const patternTracker = options.patternTracker || new PatternTracker();
  const sessionManager = options.sessionManager || new SessionContextManager();
  const priorityQueue = options.priorityQueue || new PriorityQueue();

  return {
    // Agent definitions
    agents: GOODFLOWS_AGENTS,

    // Hooks for GoodFlows features
    hooks: createGoodFlowsHooks({
      contextStore,
      patternTracker,
      sessionManager,
      priorityQueue,
    }),

    // MCP servers for external integrations
    mcpServers: {
      // Linear for issue management
      linear: {
        command: 'npx',
        args: ['linear-mcp-server'],
        env: {
          LINEAR_API_KEY: process.env.LINEAR_API_KEY,
        },
      },
      // Serena for code analysis (if available)
      ...(options.enableSerena && {
        serena: {
          command: 'npx',
          args: ['serena-mcp-server'],
        },
      }),
    },

    // GoodFlows components for direct access
    components: {
      contextStore,
      patternTracker,
      sessionManager,
      priorityQueue,
    },
  };
}

/**
 * Quick start function for running GoodFlows with Agent SDK
 *
 * @example
 * ```javascript
 * import { runGoodFlows } from "goodflows/lib/sdk-adapter";
 *
 * const result = await runGoodFlows("Run full code review");
 * console.log(result.summary);
 * ```
 */
export async function runGoodFlows(prompt, options = {}) {
  // Dynamically import SDK (avoids issues if not installed)
  let query;
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    query = sdk.query;
  } catch {
    throw new Error(
      'Claude Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk',
    );
  }

  const config = createGoodFlowsConfig(options);
  const messages = [];

  for await (const message of query({
    prompt,
    options: {
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write', 'Task'],
      agents: config.agents,
      hooks: config.hooks,
      mcpServers: config.mcpServers,
      ...options.sdkOptions,
    },
  })) {
    messages.push(message);

    // Call progress callback if provided
    if (options.onProgress) {
      options.onProgress(message);
    }
  }

  // Get final summary from session
  const summary = config.components.sessionManager.getSummary();

  return {
    messages,
    summary,
    stats: {
      queue: config.components.priorityQueue.getStats(),
      session: summary,
    },
  };
}

export default {
  GOODFLOWS_AGENTS,
  LINEAR_MCP_TOOLS,
  SERENA_MCP_TOOLS,
  createGoodFlowsHooks,
  createGoodFlowsConfig,
  runGoodFlows,
};
