/**
 * Tests for agent-registry.js
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  AgentRegistry,
  AGENT_SCHEMAS,
  LABEL_MAPPING,
  TITLE_PREFIXES,
} from '../../lib/agent-registry.js';

describe('AgentRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new AgentRegistry({
      agentsDir: './test-agents',
      contextDir: './test-context',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create registry with default options', () => {
      const defaultRegistry = new AgentRegistry();
      expect(defaultRegistry.agentsDir).toBe('.claude/agents');
      expect(defaultRegistry.contextDir).toBe('.goodflows/context');
    });

    it('should create registry with custom options', () => {
      expect(registry.agentsDir).toBe('./test-agents');
      expect(registry.contextDir).toBe('./test-context');
    });

    it('should initialize with empty agents map', () => {
      expect(registry.agents.size).toBe(0);
    });

    it('should initialize with empty invocation history', () => {
      expect(registry.invocationHistory).toEqual([]);
    });
  });

  describe('parseAgentDefinition', () => {
    it('should parse agent definition from markdown content', () => {
      const content = `---
name: test-agent
description: A test agent
model: sonnet
tools:
  - Read
  - Write
triggers:
  - "run test"
---

Agent instructions here.`;

      const agent = registry.parseAgentDefinition(content, 'test-agent.md');

      expect(agent.name).toBe('test-agent');
      expect(agent.description).toBe('A test agent');
      expect(agent.model).toBe('sonnet');
      expect(agent.tools).toEqual(['Read', 'Write']);
      expect(agent.triggers).toEqual(['run test']);
      expect(agent.filename).toBe('test-agent.md');
    });

    it('should return null for content without frontmatter', () => {
      const content = 'Just some regular markdown content';
      const agent = registry.parseAgentDefinition(content, 'test.md');
      expect(agent).toBeNull();
    });

    it('should handle inline arrays', () => {
      const content = `---
name: inline-test
tools: [Read, Write, Glob]
---`;

      const agent = registry.parseAgentDefinition(content, 'inline.md');
      expect(agent.tools).toEqual(['Read', 'Write', 'Glob']);
    });

    it('should attach schema if defined', () => {
      const content = `---
name: review-orchestrator
description: Orchestrator agent
---`;

      const agent = registry.parseAgentDefinition(content, 'orchestrator.md');
      expect(agent.schema).toBe(AGENT_SCHEMAS['review-orchestrator']);
    });

    it('should set null schema if not defined', () => {
      const content = `---
name: unknown-agent
description: Unknown agent
---`;

      const agent = registry.parseAgentDefinition(content, 'unknown.md');
      expect(agent.schema).toBeNull();
    });
  });

  describe('getAgents', () => {
    it('should return empty array when no agents registered', () => {
      expect(registry.getAgents()).toEqual([]);
    });

    it('should return all registered agents', () => {
      registry.agents.set('agent1', { name: 'agent1' });
      registry.agents.set('agent2', { name: 'agent2' });

      const agents = registry.getAgents();
      expect(agents.length).toBe(2);
      expect(agents.map(a => a.name)).toContain('agent1');
      expect(agents.map(a => a.name)).toContain('agent2');
    });
  });

  describe('getAgent', () => {
    it('should return undefined for non-existent agent', () => {
      expect(registry.getAgent('non-existent')).toBeUndefined();
    });

    it('should return agent by name', () => {
      const agent = { name: 'test-agent', model: 'sonnet' };
      registry.agents.set('test-agent', agent);

      expect(registry.getAgent('test-agent')).toBe(agent);
    });
  });

  describe('getSchema', () => {
    it('should return schema for known agent', () => {
      expect(registry.getSchema('review-orchestrator')).toBe(AGENT_SCHEMAS['review-orchestrator']);
    });

    it('should return null for unknown agent', () => {
      expect(registry.getSchema('unknown-agent')).toBeNull();
    });
  });

  describe('validateInput', () => {
    it('should return valid for agent without schema', () => {
      const result = registry.validateInput('unknown-agent', { foo: 'bar' });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate required fields', () => {
      const result = registry.validateInput('issue-creator', {});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: findings');
    });

    it('should pass validation with required fields', () => {
      const result = registry.validateInput('issue-creator', {
        findings: [{ file: 'test.js', type: 'bug', description: 'Test bug' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should apply default values', () => {
      const result = registry.validateInput('review-orchestrator', {});
      expect(result.input.reviewType).toBe('uncommitted');
      expect(result.input.autoFix).toBe(false);
      expect(result.input.priorityThreshold).toBe(4);
    });
  });

  describe('session management', () => {
    it('should start session and return session ID', () => {
      const sessionId = registry.startSession({ trigger: 'test' });
      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe('string');
      expect(registry.sessionManager).not.toBeNull();
    });

    it('should get session after starting', () => {
      registry.startSession({ trigger: 'test' });
      const session = registry.getSession();
      expect(session).not.toBeNull();
    });

    it('should return null session when not started', () => {
      expect(registry.getSession()).toBeNull();
    });

    it('should get session ID after starting', () => {
      const startId = registry.startSession({ trigger: 'test' });
      const getId = registry.getSessionId();
      expect(getId).toBe(startId);
    });

    it('should return null session ID when not started', () => {
      expect(registry.getSessionId()).toBeNull();
    });

    it('should set and get context', () => {
      registry.startSession({ trigger: 'test' });
      registry.setContext('test.value', 123);
      expect(registry.getContext('test.value')).toBe(123);
    });

    it('should return default value for missing context', () => {
      registry.startSession({ trigger: 'test' });
      expect(registry.getContext('missing.path', 'default')).toBe('default');
    });

    it('should return default value when no session', () => {
      expect(registry.getContext('path', 'fallback')).toBe('fallback');
    });

    it('should create and rollback checkpoint', () => {
      registry.startSession({ trigger: 'test' });
      registry.setContext('value', 'original');

      const checkpointId = registry.checkpoint('before_change');
      expect(checkpointId).toBeTruthy();

      registry.setContext('value', 'modified');
      expect(registry.getContext('value')).toBe('modified');

      registry.rollback(checkpointId);
      expect(registry.getContext('value')).toBe('original');
    });

    it('should return null checkpoint when no session', () => {
      expect(registry.checkpoint('test')).toBeNull();
    });

    it('should end session with summary', () => {
      registry.startSession({ trigger: 'test' });
      const result = registry.endSession({ totalIssues: 5 });
      // endSession returns the session summary or null
      expect(result).not.toBeNull();
    });
  });

  describe('createInvocation', () => {
    it('should create invocation with validation', () => {
      registry.startSession({ trigger: 'test' });

      const invocation = registry.createInvocation('issue-creator', {
        findings: [{ file: 'test.js', type: 'bug', description: 'Test' }],
        team: 'TEST',
      });

      expect(invocation.target).toBe('issue-creator');
      expect(invocation.input.team).toBe('TEST');
      expect(invocation.status).toBe('pending');
      expect(invocation.id).toBeTruthy();
    });

    it('should throw for invalid input', () => {
      expect(() => registry.createInvocation('issue-creator', {}))
        .toThrow('Invalid input');
    });

    it('should track invocation in history', () => {
      registry.startSession({ trigger: 'test' });
      registry.createInvocation('review-orchestrator', {});

      expect(registry.invocationHistory.length).toBe(1);
    });
  });

  describe('recordResult', () => {
    it('should record result for invocation', () => {
      registry.startSession({ trigger: 'test' });
      const invocation = registry.createInvocation('review-orchestrator', {});

      registry.recordResult(invocation.id, {
        status: 'success',
        issues: { created: ['GOO-1'] },
      });

      // recordResult sets status from result.status OR 'completed'
      expect(invocation.status).toBe('success');
      expect(invocation.result.issues.created).toContain('GOO-1');
    });

    it('should handle non-existent invocation', () => {
      // Should not throw
      registry.recordResult('non-existent', { status: 'success' });
    });
  });

  describe('getSessionHistory', () => {
    it('should return history from session', () => {
      registry.startSession({ trigger: 'test' });
      registry.createInvocation('review-orchestrator', {});

      const history = registry.getSessionHistory();
      // getSessionHistory returns array directly (via sessionManager.getInvocationChain)
      expect(Array.isArray(history)).toBe(true);
    });

    it('should return empty array when no session', () => {
      const history = registry.getSessionHistory();
      expect(history).toEqual([]);
    });
  });

  describe('priority functions', () => {
    const findings = [
      { type: 'documentation', file: 'docs.md' },
      { type: 'critical_security', file: 'auth.js' },
      { type: 'potential_issue', file: 'api.js' },
      { type: 'refactor_suggestion', file: 'utils.js' },
    ];

    it('should sort findings by priority', () => {
      const sorted = registry.sortByPriority(findings);
      expect(sorted[0].type).toBe('critical_security'); // P1
      expect(sorted[1].type).toBe('potential_issue');   // P2
      expect(sorted[2].type).toBe('refactor_suggestion'); // P3
      expect(sorted[3].type).toBe('documentation');     // P4
    });

    it('should filter findings by priority threshold', () => {
      const filtered = registry.filterByPriority(findings, 2);
      expect(filtered.length).toBe(2);
      expect(filtered.map(f => f.type)).toContain('critical_security');
      expect(filtered.map(f => f.type)).toContain('potential_issue');
    });

    it('should group findings by priority', () => {
      const groups = registry.groupByPriority(findings);
      expect(groups.urgent.length).toBe(1);
      expect(groups.high.length).toBe(1);
      expect(groups.normal.length).toBe(1);
      expect(groups.low.length).toBe(1);
    });

    it('should group findings by file', () => {
      const findingsWithSameFile = [
        { file: 'auth.js', type: 'bug' },
        { file: 'auth.js', type: 'security' },
        { file: 'api.js', type: 'bug' },
      ];

      const groups = registry.groupByFile(findingsWithSameFile);
      expect(groups.get('auth.js').length).toBe(2);
      expect(groups.get('api.js').length).toBe(1);
    });
  });

  describe('queue operations', () => {
    const findings = [
      { type: 'documentation', file: 'docs.md', description: 'Update docs' },
      { type: 'critical_security', file: 'auth.js', description: 'Security fix' },
    ];

    it('should create queue with findings', () => {
      registry.createQueue(findings);
      expect(registry.findingsQueue).not.toBeNull();
    });

    it('should return existing queue', () => {
      registry.createQueue(findings);
      const queue = registry.getQueue();
      expect(queue).toBe(registry.findingsQueue);
    });

    it('should process findings in priority order', () => {
      registry.createQueue(findings);

      const first = registry.nextFinding();
      expect(first.type).toBe('critical_security'); // P1 comes first

      const second = registry.nextFinding();
      expect(second.type).toBe('documentation'); // P4 comes second
    });

    it('should peek without dequeuing', () => {
      registry.createQueue(findings);

      const peeked = registry.peekNextFinding();
      const next = registry.nextFinding();

      expect(peeked.type).toBe(next.type);
    });

    it('should return null for empty queue operations', () => {
      expect(registry.nextFinding()).toBeNull();
      expect(registry.peekNextFinding()).toBeNull();
    });

    it('should return null stats for no queue', () => {
      expect(registry.getQueueStats()).toBeNull();
    });

    it('should get queue stats', () => {
      registry.createQueue(findings);
      const stats = registry.getQueueStats();
      expect(stats.pending).toBe(2);
    });

    it('should complete finding', () => {
      registry.createQueue(findings);
      registry.nextFinding();
      registry.completeFinding({ issueId: 'GOO-1' });

      const stats = registry.getQueueStats();
      expect(stats.completed).toBe(1);
    });

    it('should fail finding', () => {
      registry.createQueue(findings);
      registry.nextFinding();
      registry.failFinding('Test error');

      const stats = registry.getQueueStats();
      // Failed items get requeued, so pending should include the retried item
      expect(stats.pending + stats.failed).toBeGreaterThanOrEqual(1);
    });

    it('should enqueue additional findings', () => {
      registry.createQueue([findings[0]]);
      expect(registry.getQueueStats().pending).toBe(1);

      registry.enqueueFindings([findings[1]]);
      expect(registry.getQueueStats().pending).toBe(2);
    });

    it('should process queue with handler', async () => {
      registry.createQueue(findings);
      const processed = [];

      await registry.processQueue(async (finding) => {
        processed.push(finding.type);
        return { success: true };
      });

      expect(processed.length).toBe(2);
      expect(processed[0]).toBe('critical_security'); // P1 first
    });

    it('should throw when processing without queue', async () => {
      await expect(registry.processQueue(async () => {}))
        .rejects.toThrow('No queue');
    });
  });

  describe('issue helpers', () => {
    it('should generate issue title with prefix', () => {
      const title = registry.generateIssueTitle({
        type: 'critical_security',
        description: 'Hardcoded API key in config',
      });

      expect(title).toBe('[SECURITY] Hardcoded API key in config');
    });

    it('should truncate long descriptions', () => {
      const longDescription = 'A'.repeat(200);
      const title = registry.generateIssueTitle({
        type: 'potential_issue',
        description: longDescription,
      });

      expect(title.length).toBeLessThanOrEqual(103); // 'fix: ' + 97 + '...'
    });

    it('should get labels for type', () => {
      expect(registry.getLabelsForType('critical_security'))
        .toEqual(['security', 'critical']);
      expect(registry.getLabelsForType('potential_issue'))
        .toEqual(['bug']);
    });

    it('should return empty array for unknown type', () => {
      expect(registry.getLabelsForType('unknown')).toEqual([]);
    });

    it('should get priority for type', () => {
      expect(registry.getPriorityForType('critical_security')).toBe(1);
      expect(registry.getPriorityForType('potential_issue')).toBe(2);
      expect(registry.getPriorityForType('documentation')).toBe(4);
    });

    it('should return default priority for unknown type', () => {
      expect(registry.getPriorityForType('unknown')).toBe(4);
    });
  });
});

describe('AGENT_SCHEMAS', () => {
  it('should have schema for review-orchestrator', () => {
    expect(AGENT_SCHEMAS['review-orchestrator']).toBeDefined();
    expect(AGENT_SCHEMAS['review-orchestrator'].input).toBeDefined();
    expect(AGENT_SCHEMAS['review-orchestrator'].output).toBeDefined();
  });

  it('should have schema for issue-creator', () => {
    expect(AGENT_SCHEMAS['issue-creator']).toBeDefined();
    expect(AGENT_SCHEMAS['issue-creator'].input.required).toContain('findings');
  });

  it('should have schema for coderabbit-auto-fixer', () => {
    expect(AGENT_SCHEMAS['coderabbit-auto-fixer']).toBeDefined();
  });
});

describe('LABEL_MAPPING', () => {
  it('should map critical_security to security and critical labels', () => {
    expect(LABEL_MAPPING.critical_security).toEqual(['security', 'critical']);
  });

  it('should map potential_issue to bug label', () => {
    expect(LABEL_MAPPING.potential_issue).toEqual(['bug']);
  });

  it('should map all finding types', () => {
    expect(LABEL_MAPPING.refactor_suggestion).toBeDefined();
    expect(LABEL_MAPPING.performance).toBeDefined();
    expect(LABEL_MAPPING.documentation).toBeDefined();
  });
});

describe('TITLE_PREFIXES', () => {
  it('should have prefix for security issues', () => {
    expect(TITLE_PREFIXES.critical_security).toBe('[SECURITY]');
  });

  it('should have conventional commit prefixes', () => {
    expect(TITLE_PREFIXES.potential_issue).toBe('fix:');
    expect(TITLE_PREFIXES.refactor_suggestion).toBe('refactor:');
    expect(TITLE_PREFIXES.performance).toBe('perf:');
    expect(TITLE_PREFIXES.documentation).toBe('docs:');
  });
});
