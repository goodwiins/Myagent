/**
 * GoodFlows Agent Registry
 *
 * Provides programmatic agent invocation, input validation,
 * and inter-agent communication for the GoodFlows multi-agent system.
 *
 * @module goodflows/lib/agent-registry
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SessionContextManager, SESSION_STATES } from './session-context.js';
import { PriorityQueue, PRIORITY, TYPE_TO_PRIORITY, ITEM_STATE } from './priority-queue.js';

/**
 * Agent input/output schemas for validation
 */
export const AGENT_SCHEMAS = {
  'review-orchestrator': {
    input: {
      type: 'object',
      properties: {
        reviewType: {
          type: 'string',
          enum: ['uncommitted', 'staged', 'pr', 'branch'],
          default: 'uncommitted',
        },
        prNumber: { type: 'number', description: 'PR number for pr review type' },
        branchName: { type: 'string', description: 'Branch name for branch review type' },
        autoFix: { type: 'boolean', default: false },
        priorityThreshold: {
          type: 'number',
          enum: [1, 2, 3, 4],
          default: 4,
          description: 'Only process issues at or above this priority',
        },
        team: { type: 'string', default: 'GOO' },
        sessionId: { type: 'string', description: 'Session ID for context propagation' },
      },
      required: [],
    },
    output: {
      type: 'object',
      properties: {
        agent: { type: 'string', const: 'review-orchestrator' },
        status: { type: 'string', enum: ['success', 'partial', 'failed'] },
        summary: {
          type: 'object',
          properties: {
            totalFindings: { type: 'number' },
            issuesCreated: { type: 'number' },
            duplicatesSkipped: { type: 'number' },
            autoFixed: { type: 'number' },
            manualReview: { type: 'number' },
          },
        },
        issues: {
          type: 'object',
          properties: {
            created: { type: 'array', items: { type: 'string' } },
            fixed: { type: 'array', items: { type: 'string' } },
            pending: { type: 'array', items: { type: 'string' } },
          },
        },
        errors: { type: 'array', items: { type: 'string' } },
        sessionId: { type: 'string' },
      },
    },
  },

  'issue-creator': {
    input: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              lines: { type: 'string' },
              type: {
                type: 'string',
                enum: ['critical_security', 'potential_issue', 'refactor_suggestion', 'performance', 'documentation'],
              },
              description: { type: 'string' },
              proposedFix: { type: 'string' },
              severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
            },
            required: ['file', 'type', 'description'],
          },
        },
        team: { type: 'string', default: 'GOO' },
        options: {
          type: 'object',
          properties: {
            groupByFile: { type: 'boolean', default: true },
            checkDuplicates: { type: 'boolean', default: true },
          },
        },
        sessionId: { type: 'string' },
      },
      required: ['findings'],
    },
    output: {
      type: 'object',
      properties: {
        agent: { type: 'string', const: 'issue-creator' },
        status: { type: 'string', enum: ['success', 'partial', 'failed'] },
        created: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              url: { type: 'string' },
              title: { type: 'string' },
              priority: { type: 'number' },
              labels: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        duplicatesSkipped: { type: 'number' },
        errors: { type: 'array', items: { type: 'string' } },
        sessionId: { type: 'string' },
      },
    },
  },

  'coderabbit-auto-fixer': {
    input: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          items: { type: 'string' },
          description: 'Linear issue IDs to fix (e.g., ["GOO-31", "GOO-32"])',
        },
        options: {
          type: 'object',
          properties: {
            verify: { type: 'boolean', default: true },
            updateLinear: { type: 'boolean', default: true },
            maxAttempts: { type: 'number', default: 3 },
            revertOnFailure: { type: 'boolean', default: true },
          },
        },
        sessionId: { type: 'string' },
      },
      required: ['issues'],
    },
    output: {
      type: 'object',
      properties: {
        agent: { type: 'string', const: 'coderabbit-auto-fixer' },
        status: { type: 'string', enum: ['success', 'partial', 'failed'] },
        fixed: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              issueId: { type: 'string' },
              file: { type: 'string' },
              patternUsed: { type: 'string' },
              verified: { type: 'boolean' },
            },
          },
        },
        failed: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              issueId: { type: 'string' },
              reason: { type: 'string' },
              attempts: { type: 'number' },
            },
          },
        },
        errors: { type: 'array', items: { type: 'string' } },
        sessionId: { type: 'string' },
      },
    },
  },
};

/**
 * Priority levels for findings
 */
export const PRIORITY_LEVELS = {
  critical_security: 1,
  potential_issue: 2,
  refactor_suggestion: 3,
  performance: 3,
  documentation: 4,
};

/**
 * Label mappings consistent across all agents
 */
export const LABEL_MAPPING = {
  critical_security: ['security', 'critical'],
  potential_issue: ['bug'],
  refactor_suggestion: ['improvement'],
  performance: ['performance'],
  documentation: ['docs'],
};

/**
 * Title prefixes for Linear issues
 */
export const TITLE_PREFIXES = {
  critical_security: '[SECURITY]',
  potential_issue: 'fix:',
  refactor_suggestion: 'refactor:',
  performance: 'perf:',
  documentation: 'docs:',
};

/**
 * Agent Registry - manages agent registration, invocation, and tracking
 */
export class AgentRegistry {
  constructor(options = {}) {
    this.agentsDir = options.agentsDir || '.claude/agents';
    this.contextDir = options.contextDir || '.goodflows/context';
    this.agents = new Map();
    this.invocationHistory = [];
    this.sessionManager = null; // SessionContextManager instance
    this.findingsQueue = null;  // PriorityQueue instance
  }

  /**
   * Load agent definitions from markdown files
   */
  loadAgents() {
    const agentsPath = this.agentsDir;
    if (!existsSync(agentsPath)) {
      return;
    }

    const files = readdirSync(agentsPath).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const content = readFileSync(join(agentsPath, file), 'utf-8');
      const agent = this.parseAgentDefinition(content, file);
      if (agent) {
        this.agents.set(agent.name, agent);
      }
    }
  }

  /**
   * Parse YAML frontmatter from agent markdown file
   */
  parseAgentDefinition(content, filename) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const yaml = frontmatterMatch[1];
    const agent = {
      name: '',
      description: '',
      model: 'sonnet',
      tools: [],
      triggers: [],
      filename,
    };

    // Simple YAML parsing
    const lines = yaml.split('\n');
    let currentKey = null;
    let currentArray = [];

    for (const line of lines) {
      const keyMatch = line.match(/^(\w+):\s*(.*)$/);
      if (keyMatch) {
        if (currentKey && currentArray.length > 0) {
          agent[currentKey] = currentArray;
          currentArray = [];
        }
        currentKey = keyMatch[1];
        const value = keyMatch[2].trim();
        if (value && !value.startsWith('[')) {
          agent[currentKey] = value;
          currentKey = null;
        } else if (value.startsWith('[')) {
          // Inline array
          const items = value.slice(1, -1).split(',').map((s) => s.trim());
          agent[currentKey] = items;
          currentKey = null;
        }
      } else if (line.trim().startsWith('- ') && currentKey) {
        currentArray.push(line.trim().slice(2).replace(/^["']|["']$/g, ''));
      }
    }

    if (currentKey && currentArray.length > 0) {
      agent[currentKey] = currentArray;
    }

    // Attach schema if defined
    agent.schema = AGENT_SCHEMAS[agent.name] || null;

    return agent;
  }

  /**
   * Get all registered agents
   */
  getAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * Get a specific agent by name
   */
  getAgent(name) {
    return this.agents.get(name);
  }

  /**
   * Get the schema for an agent
   */
  getSchema(name) {
    return AGENT_SCHEMAS[name] || null;
  }

  /**
   * Validate input against agent schema
   */
  validateInput(agentName, input) {
    const schema = AGENT_SCHEMAS[agentName];
    if (!schema) {
      return { valid: true, errors: [] };
    }

    const errors = [];
    const inputSchema = schema.input;

    // Check required fields
    if (inputSchema.required) {
      for (const field of inputSchema.required) {
        if (!(field in input)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    // Apply defaults
    const withDefaults = { ...input };
    if (inputSchema.properties) {
      for (const [key, prop] of Object.entries(inputSchema.properties)) {
        if (!(key in withDefaults) && 'default' in prop) {
          withDefaults[key] = prop.default;
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      input: withDefaults,
    };
  }

  /**
   * Start a new session for context propagation
   * Uses SessionContextManager for full context management
   */
  startSession(metadata = {}) {
    this.sessionManager = new SessionContextManager({
      basePath: join(this.contextDir, 'sessions'),
    });
    return this.sessionManager.start(metadata);
  }

  /**
   * Resume an existing session
   */
  resumeSession(sessionId) {
    this.sessionManager = SessionContextManager.resume(sessionId, {
      basePath: join(this.contextDir, 'sessions'),
    });
    return this.sessionManager;
  }

  /**
   * Get the current session manager
   */
  getSession() {
    return this.sessionManager;
  }

  /**
   * Get the current session ID
   */
  getSessionId() {
    return this.sessionManager?.getId() || null;
  }

  /**
   * End the current session
   */
  endSession(summary = {}) {
    if (this.sessionManager) {
      this.sessionManager.complete(summary);
      const sessionSummary = this.sessionManager.getSummary();
      this.sessionManager = null;
      return sessionSummary;
    }
    return null;
  }

  /**
   * Set context value (delegates to session manager)
   */
  setContext(path, value, meta = {}) {
    if (this.sessionManager) {
      this.sessionManager.set(path, value, meta);
    }
  }

  /**
   * Get context value (delegates to session manager)
   */
  getContext(path, defaultValue) {
    if (this.sessionManager) {
      return this.sessionManager.get(path, defaultValue);
    }
    return defaultValue;
  }

  /**
   * Create a checkpoint (delegates to session manager)
   */
  checkpoint(label) {
    if (this.sessionManager) {
      return this.sessionManager.checkpoint(label);
    }
    return null;
  }

  /**
   * Rollback to checkpoint (delegates to session manager)
   */
  rollback(checkpointId) {
    if (this.sessionManager) {
      return this.sessionManager.rollback(checkpointId);
    }
    return false;
  }

  /**
   * Create an invocation request object
   * This is what gets passed between agents
   */
  createInvocation(agentName, input, options = {}) {
    const validation = this.validateInput(agentName, input);
    if (!validation.valid) {
      throw new Error(`Invalid input for ${agentName}: ${validation.errors.join(', ')}`);
    }

    const sessionId = options.sessionId || this.getSessionId();

    const invocation = {
      id: `inv_${Date.now()}_${createHash('sha256').update(Math.random().toString()).digest('hex').slice(0, 8)}`,
      target: agentName,
      input: validation.input,
      sessionId,
      createdAt: new Date().toISOString(),
      status: 'pending',
      parentInvocation: options.parentInvocation || null,
    };

    this.invocationHistory.push(invocation);

    // Record in session manager
    if (this.sessionManager) {
      this.sessionManager.recordInvocation(agentName, validation.input, options.parentAgent);
    }

    return invocation;
  }

  /**
   * Record invocation result
   */
  recordResult(invocationId, result) {
    const invocation = this.invocationHistory.find((i) => i.id === invocationId);
    if (invocation) {
      invocation.status = result.status || 'completed';
      invocation.result = result;
      invocation.completedAt = new Date().toISOString();

      // Record in session manager
      if (this.sessionManager) {
        this.sessionManager.recordInvocationResult(invocationId, result, invocation.status);
      }
    }
    return invocation;
  }

  /**
   * Get invocation history for the current session
   */
  getSessionHistory() {
    if (this.sessionManager) {
      return this.sessionManager.getInvocationChain();
    }
    return [];
  }

  /**
   * Sort findings by priority (critical first)
   */
  sortByPriority(findings) {
    return [...findings].sort((a, b) => {
      const priorityA = PRIORITY_LEVELS[a.type] || 4;
      const priorityB = PRIORITY_LEVELS[b.type] || 4;
      return priorityA - priorityB;
    });
  }

  /**
   * Filter findings by priority threshold
   */
  filterByPriority(findings, threshold = 4) {
    return findings.filter((f) => {
      const priority = PRIORITY_LEVELS[f.type] || 4;
      return priority <= threshold;
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Priority Queue Operations
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a priority queue for findings
   * Items are automatically sorted by priority (critical first)
   */
  createQueue(findings = [], options = {}) {
    this.findingsQueue = new PriorityQueue({
      sessionManager: this.sessionManager,
      throttleMs: options.throttleMs || 100,
      maxRetries: options.maxRetries || 3,
      priorityThreshold: options.priorityThreshold || PRIORITY.LOW,
      ...options,
    });

    if (findings.length > 0) {
      this.findingsQueue.enqueueAll(findings);
    }

    // Store in session context
    if (this.sessionManager) {
      this.sessionManager.set('queue.created', true);
      this.sessionManager.set('queue.stats', this.findingsQueue.getStats());
    }

    return this.findingsQueue;
  }

  /**
   * Get the current findings queue
   */
  getQueue() {
    return this.findingsQueue;
  }

  /**
   * Add findings to queue (creates queue if needed)
   */
  enqueueFindings(findings) {
    if (!this.findingsQueue) {
      this.createQueue(findings);
    } else {
      this.findingsQueue.enqueueAll(findings);
    }
    return this.findingsQueue.getStats();
  }

  /**
   * Get next finding from queue (highest priority)
   */
  nextFinding() {
    if (!this.findingsQueue) return null;
    return this.findingsQueue.dequeue();
  }

  /**
   * Peek at next finding without removing
   */
  peekNextFinding() {
    if (!this.findingsQueue) return null;
    return this.findingsQueue.peek();
  }

  /**
   * Mark current finding as completed
   */
  completeFinding(result = {}) {
    if (!this.findingsQueue) return;
    this.findingsQueue.markCompleted(result);
  }

  /**
   * Mark current finding as failed
   */
  failFinding(error) {
    if (!this.findingsQueue) return;
    this.findingsQueue.markFailed(error);
  }

  /**
   * Get queue statistics
   */
  getQueueStats() {
    if (!this.findingsQueue) return null;
    return this.findingsQueue.getStats();
  }

  /**
   * Process all findings in queue with handler
   */
  async processQueue(handler) {
    if (!this.findingsQueue) {
      throw new Error('No queue created. Call createQueue() first.');
    }
    return this.findingsQueue.processAll(handler);
  }

  /**
   * Group findings by priority level
   */
  groupByPriority(findings) {
    const groups = {
      urgent: [],   // P1 - critical_security
      high: [],     // P2 - potential_issue
      normal: [],   // P3 - refactor, performance
      low: [],      // P4 - documentation
    };

    for (const finding of findings) {
      const priority = TYPE_TO_PRIORITY[finding.type] || PRIORITY.LOW;
      switch (priority) {
        case PRIORITY.URGENT:
          groups.urgent.push(finding);
          break;
        case PRIORITY.HIGH:
          groups.high.push(finding);
          break;
        case PRIORITY.NORMAL:
          groups.normal.push(finding);
          break;
        case PRIORITY.LOW:
          groups.low.push(finding);
          break;
      }
    }

    return groups;
  }

  /**
   * Group findings by file for batch issue creation
   */
  groupByFile(findings) {
    const groups = new Map();
    for (const finding of findings) {
      const file = finding.file || 'unknown';
      if (!groups.has(file)) {
        groups.set(file, []);
      }
      groups.get(file).push(finding);
    }
    return groups;
  }

  /**
   * Generate issue title based on finding type
   */
  generateIssueTitle(finding) {
    const prefix = TITLE_PREFIXES[finding.type] || '';
    const description = finding.description?.split('\n')[0]?.slice(0, 60) || 'Issue found';
    return `${prefix} ${description}`.trim();
  }

  /**
   * Get labels for a finding type
   */
  getLabelsForType(type) {
    return LABEL_MAPPING[type] || [];
  }

  /**
   * Get priority number for a finding type
   */
  getPriorityForType(type) {
    return PRIORITY_LEVELS[type] || 4;
  }
}

/**
 * Create a pre-configured agent registry
 */
export function createAgentRegistry(options = {}) {
  const registry = new AgentRegistry(options);
  registry.loadAgents();
  return registry;
}

/**
 * Inter-agent communication helper
 * Creates a structured request for one agent to call another
 */
export function createAgentRequest(targetAgent, input, options = {}) {
  const registry = createAgentRegistry();
  return registry.createInvocation(targetAgent, input, options);
}

// Re-export session types for convenience
export { SessionContextManager, SESSION_STATES } from './session-context.js';

// Re-export priority queue types
export { PriorityQueue, PRIORITY, TYPE_TO_PRIORITY, ITEM_STATE } from './priority-queue.js';

export default {
  AgentRegistry,
  createAgentRegistry,
  createAgentRequest,
  AGENT_SCHEMAS,
  PRIORITY_LEVELS,
  LABEL_MAPPING,
  TITLE_PREFIXES,
  SESSION_STATES,
  PriorityQueue,
  PRIORITY,
  TYPE_TO_PRIORITY,
  ITEM_STATE,
};
