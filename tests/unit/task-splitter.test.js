/**
 * Tests for task-splitter.js
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_SUBTASKS,
  COMPLEXITY,
  detectComplexity,
  detectTaskType,
  extractActions,
  groupActionsByType,
  splitTask,
  analyzeTask,
  shouldAutoSplit,
  estimateExecutionTime,
} from '../../lib/task-splitter.js';
import { PRIORITY } from '../../lib/priority-queue.js';

describe('Constants', () => {
  describe('MAX_SUBTASKS', () => {
    it('should be 3', () => {
      expect(MAX_SUBTASKS).toBe(3);
    });
  });

  describe('COMPLEXITY', () => {
    it('should have all complexity levels', () => {
      expect(COMPLEXITY.TRIVIAL).toBe(1);
      expect(COMPLEXITY.SIMPLE).toBe(3);
      expect(COMPLEXITY.MODERATE).toBe(5);
      expect(COMPLEXITY.COMPLEX).toBe(7);
      expect(COMPLEXITY.VERY_COMPLEX).toBe(9);
    });
  });
});

describe('detectComplexity', () => {
  it('should return low complexity for simple tasks', () => {
    const simple = 'Fix typo';
    const complexity = detectComplexity(simple);
    expect(complexity).toBeLessThanOrEqual(COMPLEXITY.MODERATE);
  });

  it('should increase complexity for conjunctions', () => {
    const withConjunctions = 'Fix the bug and update the tests and deploy';
    const complexity = detectComplexity(withConjunctions);
    expect(complexity).toBeGreaterThan(COMPLEXITY.SIMPLE);
  });

  it('should increase complexity for multiple files reference', () => {
    const multipleFiles = 'Update all files in the codebase to use new API';
    const complexity = detectComplexity(multipleFiles);
    expect(complexity).toBeGreaterThanOrEqual(COMPLEXITY.MODERATE);
  });

  it('should increase complexity for conditionals', () => {
    const conditional = 'If the user is admin then show dashboard, else show limited view';
    const complexity = detectComplexity(conditional);
    expect(complexity).toBeGreaterThan(COMPLEXITY.SIMPLE);
  });

  it('should increase complexity for verification requirements', () => {
    const withVerification = 'Update the API and ensure all tests pass and verify deployment';
    const complexity = detectComplexity(withVerification);
    expect(complexity).toBeGreaterThan(COMPLEXITY.SIMPLE);
  });

  it('should clamp complexity to 1-10 range', () => {
    const veryComplex = 'Review and fix all security vulnerabilities across the entire codebase and then update all tests and ensure everything works and verify with manual testing and also add documentation';
    const complexity = detectComplexity(veryComplex);
    expect(complexity).toBeLessThanOrEqual(10);
    expect(complexity).toBeGreaterThanOrEqual(1);
  });

  it('should increase complexity for long tasks', () => {
    const longTask = Array(60).fill('word').join(' ');
    const shortTask = 'fix bug';
    expect(detectComplexity(longTask)).toBeGreaterThan(detectComplexity(shortTask));
  });
});

describe('detectTaskType', () => {
  it('should detect security tasks', () => {
    const securityTasks = [
      'Fix the security vulnerability',
      'Remove hardcoded API key',
      'Fix SQL injection issue',
      'Patch XSS vulnerability',
    ];

    for (const task of securityTasks) {
      const result = detectTaskType(task);
      expect(result.type).toBe('security');
      expect(result.priority).toBe(PRIORITY.URGENT);
      expect(result.agentType).toBe('coderabbit-auto-fixer');
    }
  });

  it('should detect bug fix tasks', () => {
    const bugTasks = [
      'Fix the login error',
      'Resolve the crash on startup',
      'Fix broken submit button',
    ];

    for (const task of bugTasks) {
      const result = detectTaskType(task);
      expect(result.type).toBe('bugfix');
      expect(result.priority).toBe(PRIORITY.HIGH);
    }
  });

  it('should detect review tasks', () => {
    // Note: patterns are checked in order, avoid words that match earlier patterns
    const reviewTasks = [
      'Review the PR changes',
      'Audit the codebase',
      'Inspect the module',
    ];

    for (const task of reviewTasks) {
      const result = detectTaskType(task);
      expect(result.type).toBe('review');
      expect(result.agentType).toBe('review-orchestrator');
    }
  });

  it('should detect refactor tasks', () => {
    const refactorTasks = [
      'Refactor the user service',
      'Clean up the API handlers',
      'Optimize the database queries',
    ];

    for (const task of refactorTasks) {
      const result = detectTaskType(task);
      expect(result.type).toBe('refactor');
    }
  });

  it('should detect test tasks', () => {
    const testTasks = [
      'Add unit tests for the service',
      'Improve test coverage',
      'Write integration tests',
    ];

    for (const task of testTasks) {
      const result = detectTaskType(task);
      expect(result.type).toBe('test');
    }
  });

  it('should detect documentation tasks', () => {
    const docsTasks = [
      'Update the README',
      'Add JSDoc comments',
      'Document the API endpoints',
    ];

    for (const task of docsTasks) {
      const result = detectTaskType(task);
      expect(result.type).toBe('docs');
      expect(result.priority).toBe(PRIORITY.LOW);
    }
  });

  it('should detect issue creation tasks', () => {
    // Note: 'issue' is also in bugfix pattern, so we need specific patterns
    // The issues pattern requires 'create.*issue' or 'linear.*issue' or 'track' or 'ticket'
    const result1 = detectTaskType('Track this in the backlog');
    expect(result1.type).toBe('issues');
    expect(result1.agentType).toBe('issue-creator');

    const result2 = detectTaskType('Open a ticket for this');
    expect(result2.type).toBe('issues');
  });

  it('should return general for unrecognized tasks', () => {
    const result = detectTaskType('Do something random');
    expect(result.type).toBe('general');
    expect(result.priority).toBe(PRIORITY.NORMAL);
    expect(result.agentType).toBe('general');
  });
});

describe('extractActions', () => {
  it('should split task by "and"', () => {
    const task = 'Fix the bug and update the tests';
    const actions = extractActions(task);
    expect(actions.length).toBe(2);
    expect(actions[0]).toContain('Fix the bug');
    expect(actions[1]).toContain('update the tests');
  });

  it('should split task by "then"', () => {
    // Fragments must be > 10 chars to be kept
    const task = 'First do something then do something else';
    const actions = extractActions(task);
    expect(actions.length).toBe(2);
  });

  it('should split task by "also"', () => {
    const task = 'Fix the main issue also check for related problems';
    const actions = extractActions(task);
    expect(actions.length).toBe(2);
  });

  it('should split task by commas', () => {
    // Fragments must be > 10 chars to be kept
    const task = 'Fix the database bugs, update all tests, deploy changes today';
    const actions = extractActions(task);
    expect(actions.length).toBeGreaterThanOrEqual(2);
  });

  it('should return whole task if no splits found', () => {
    const task = 'Just a simple single task';
    const actions = extractActions(task);
    expect(actions.length).toBe(1);
    expect(actions[0]).toBe(task);
  });

  it('should ignore very short fragments', () => {
    const task = 'Fix a and b and update all tests';
    const actions = extractActions(task);
    // 'a' and 'b' should be ignored as too short
    expect(actions.every(a => a.length > 10)).toBe(true);
  });
});

describe('groupActionsByType', () => {
  it('should group actions by their detected type', () => {
    const actions = [
      'Fix the security vulnerability',
      'Update the documentation',
      'Add unit tests',
    ];

    const groups = groupActionsByType(actions);

    expect(groups.security.length).toBe(1);
    expect(groups.docs.length).toBe(1);
    expect(groups.test.length).toBe(1);
  });

  it('should put unrecognized actions in general group', () => {
    const actions = ['Do something random', 'Another random thing'];
    const groups = groupActionsByType(actions);

    expect(groups.general.length).toBe(2);
  });

  it('should handle empty actions array', () => {
    const groups = groupActionsByType([]);

    expect(Object.keys(groups).length).toBeGreaterThan(0);
    expect(Object.values(groups).every(g => g.length === 0)).toBe(true);
  });
});

describe('splitTask', () => {
  it('should not split simple tasks', () => {
    const simpleTask = 'Fix the typo';
    const result = splitTask(simpleTask);

    expect(result.complexity).toBeLessThanOrEqual(COMPLEXITY.SIMPLE);
    expect(result.subtasks.length).toBe(1);
  });

  it('should split complex tasks into subtasks', () => {
    const complexTask = 'Review all security issues and create Linear issues and fix the critical vulnerabilities';
    const result = splitTask(complexTask);

    expect(result.subtasks.length).toBeGreaterThan(1);
    expect(result.subtasks.length).toBeLessThanOrEqual(MAX_SUBTASKS);
  });

  it('should respect maxSubtasks option', () => {
    const complexTask = 'Do many things and more things and even more things and other stuff';
    const result = splitTask(complexTask, { maxSubtasks: 2 });

    expect(result.subtasks.length).toBeLessThanOrEqual(2);
  });

  it('should never exceed MAX_SUBTASKS', () => {
    const complexTask = 'Do many things and more things and even more things and other stuff';
    const result = splitTask(complexTask, { maxSubtasks: 10 });

    expect(result.subtasks.length).toBeLessThanOrEqual(MAX_SUBTASKS);
  });

  it('should assign priorities to subtasks', () => {
    const task = 'Fix the security bug and update documentation';
    const result = splitTask(task);

    // Each subtask should have a priority
    for (const subtask of result.subtasks) {
      expect(subtask.priority).toBeDefined();
    }
  });

  it('should assign agent types to subtasks', () => {
    const task = 'Review code and fix bugs';
    const result = splitTask(task);

    for (const subtask of result.subtasks) {
      expect(subtask.agentType).toBeDefined();
    }
  });

  it('should include dependencies information', () => {
    const task = 'Review the code and then fix the issues';
    const result = splitTask(task);

    expect(result.dependencies).toBeDefined();
    // dependencies is an object mapping subtask IDs to their dependencies
    expect(typeof result.dependencies).toBe('object');
  });

  it('should sort subtasks by priority', () => {
    const task = 'Update documentation and fix security vulnerability';
    const result = splitTask(task);

    if (result.subtasks.length > 1) {
      // Security (priority 1) should come before docs (priority 4)
      const securityIndex = result.subtasks.findIndex(s =>
        s.description.toLowerCase().includes('security'),
      );
      const docsIndex = result.subtasks.findIndex(s =>
        s.description.toLowerCase().includes('doc'),
      );

      if (securityIndex !== -1 && docsIndex !== -1) {
        expect(securityIndex).toBeLessThan(docsIndex);
      }
    }
  });
});

describe('analyzeTask', () => {
  it('should return comprehensive analysis', () => {
    const task = 'Review the codebase and fix security issues';
    const analysis = analyzeTask(task);

    expect(analysis.complexity).toBeDefined();
    expect(analysis.complexityLabel).toBeDefined();
    expect(analysis.primaryType).toBeDefined();
    expect(analysis.suggestedAgentType).toBeDefined();
    expect(analysis.suggestedPriority).toBeDefined();
    expect(analysis.actionCount).toBeDefined();
    expect(analysis.activeGroups).toBeDefined();
    expect(analysis.shouldSplit).toBeDefined();
    expect(analysis.suggestedSubtasks).toBeDefined();
  });

  it('should suggest splitting for complex tasks', () => {
    const complexTask = 'Review everything and fix all bugs and update all docs';
    const analysis = analyzeTask(complexTask);

    expect(analysis.shouldSplit).toBe(true);
  });

  it('should not suggest splitting for simple tasks', () => {
    const simpleTask = 'Fix typo';
    const analysis = analyzeTask(simpleTask);

    expect(analysis.shouldSplit).toBe(false);
  });

  it('should correctly label complexity', () => {
    const trivialTask = 'Fix';
    const complexTask = 'Review all code and fix all bugs and ensure all tests pass and verify deployment works correctly';

    const trivialAnalysis = analyzeTask(trivialTask);
    const complexAnalysis = analyzeTask(complexTask);

    expect(['trivial', 'simple']).toContain(trivialAnalysis.complexityLabel);
    expect(['complex', 'very_complex', 'moderate']).toContain(complexAnalysis.complexityLabel);
  });

  it('should suggest appropriate number of subtasks', () => {
    const analysis = analyzeTask('Do many things');
    expect(analysis.suggestedSubtasks).toBeLessThanOrEqual(MAX_SUBTASKS);
    expect(analysis.suggestedSubtasks).toBeGreaterThanOrEqual(1);
  });
});

describe('shouldAutoSplit', () => {
  it('should return true for complex tasks', () => {
    const complexTask = 'Review all files and fix all issues and update all tests';
    expect(shouldAutoSplit(complexTask)).toBe(true);
  });

  it('should return false for simple tasks', () => {
    const simpleTask = 'Fix typo';
    expect(shouldAutoSplit(simpleTask)).toBe(false);
  });

  it('should respect complexity threshold option', () => {
    const moderateTask = 'Fix the bug and update tests';

    // With low threshold, should split
    expect(shouldAutoSplit(moderateTask, { complexityThreshold: COMPLEXITY.SIMPLE })).toBe(true);

    // With high threshold, should not split
    expect(shouldAutoSplit(moderateTask, { complexityThreshold: COMPLEXITY.VERY_COMPLEX })).toBe(false);
  });
});

describe('estimateExecutionTime', () => {
  it('should return time estimate object', () => {
    const task = 'Fix the bug';
    const estimate = estimateExecutionTime(task);

    expect(estimate.estimatedSeconds).toBeDefined();
    expect(estimate.estimatedMinutes).toBeDefined();
    expect(estimate.confidence).toBeDefined();
  });

  it('should estimate more time for complex tasks', () => {
    const simpleTask = 'Fix typo';
    const complexTask = 'Review all code and fix all bugs and update all tests and verify deployment';

    const simpleEstimate = estimateExecutionTime(simpleTask);
    const complexEstimate = estimateExecutionTime(complexTask);

    expect(complexEstimate.estimatedSeconds).toBeGreaterThan(simpleEstimate.estimatedSeconds);
  });

  it('should have high confidence for simple tasks', () => {
    const simpleTask = 'Fix the typo';
    const estimate = estimateExecutionTime(simpleTask);

    expect(estimate.confidence).toBe('high');
    expect(estimate.note).toBeNull();
  });

  it('should have low confidence for complex tasks', () => {
    const complexTask = 'Review and fix all security vulnerabilities across the entire codebase and ensure all tests pass';
    const estimate = estimateExecutionTime(complexTask);

    expect(estimate.confidence).toBe('low');
    expect(estimate.note).toBeTruthy();
  });

  it('should return integer values', () => {
    const task = 'Some task to do';
    const estimate = estimateExecutionTime(task);

    expect(Number.isInteger(estimate.estimatedSeconds)).toBe(true);
    expect(Number.isInteger(estimate.estimatedMinutes)).toBe(true);
  });
});
