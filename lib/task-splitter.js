/**
 * GoodFlows Task Splitter
 *
 * Analyzes complex tasks and breaks them into max 3 subtasks.
 * Uses heuristics to detect task complexity and determine optimal splits.
 *
 * @module goodflows/lib/task-splitter
 */

import { PRIORITY } from './priority-queue.js';

/**
 * Maximum subtasks per plan (hard limit)
 */
export const MAX_SUBTASKS = 3;

/**
 * Complexity thresholds
 */
export const COMPLEXITY = {
  TRIVIAL: 1,    // Single simple action
  SIMPLE: 3,     // 1-2 clear steps
  MODERATE: 5,   // Multiple steps, clear scope
  COMPLEX: 7,    // Multiple steps, some ambiguity
  VERY_COMPLEX: 9, // Many steps, significant ambiguity
};

/**
 * Task type patterns (for auto-detection)
 */
const TASK_PATTERNS = {
  // Security-related tasks
  security: {
    pattern: /security|vulnerabilit|exploit|injection|xss|csrf|auth|credential|secret|api[- ]?key/i,
    priority: PRIORITY.URGENT,
    agentType: 'coderabbit-auto-fixer',
  },
  // Bug fixes
  bugfix: {
    pattern: /fix|bug|error|crash|fail|broken|issue|problem/i,
    priority: PRIORITY.HIGH,
    agentType: 'coderabbit-auto-fixer',
  },
  // Code review
  review: {
    pattern: /review|audit|check|analyze|inspect|examine/i,
    priority: PRIORITY.NORMAL,
    agentType: 'review-orchestrator',
  },
  // Refactoring
  refactor: {
    pattern: /refactor|clean|reorganize|restructure|simplify|optimize/i,
    priority: PRIORITY.NORMAL,
    agentType: 'coderabbit-auto-fixer',
  },
  // Testing
  test: {
    pattern: /test|spec|coverage|unit|integration|e2e/i,
    priority: PRIORITY.NORMAL,
    agentType: 'general',
  },
  // Documentation
  docs: {
    pattern: /document|readme|comment|jsdoc|docstring/i,
    priority: PRIORITY.LOW,
    agentType: 'general',
  },
  // Issue creation
  issues: {
    pattern: /create.*issue|linear.*issue|track|ticket/i,
    priority: PRIORITY.NORMAL,
    agentType: 'issue-creator',
  },
};

/**
 * Complexity indicators (words/phrases that increase complexity)
 */
const COMPLEXITY_INDICATORS = {
  conjunctions: {
    pattern: /\band\b|\bthen\b|\balso\b|\bplus\b/gi,
    weight: 1,
  },
  multipleFiles: {
    pattern: /all files|entire codebase|every|across.*files|multiple/i,
    weight: 2,
  },
  conditionals: {
    pattern: /if.*then|when.*should|depending|based on/i,
    weight: 1.5,
  },
  verification: {
    pattern: /verify|ensure|make sure|confirm|validate|test/i,
    weight: 1,
  },
  comprehensiveness: {
    pattern: /complete|full|comprehensive|thorough|all/i,
    weight: 1.5,
  },
  sequentialSteps: {
    pattern: /first.*then|step \d|1\.|2\.|3\./i,
    weight: 2,
  },
};

/**
 * Detect the complexity of a task
 *
 * @param {string} task - Task description
 * @returns {number} Complexity score (1-10)
 */
export function detectComplexity(task) {
  let score = COMPLEXITY.SIMPLE; // Base score

  // Check each complexity indicator
  for (const [_name, indicator] of Object.entries(COMPLEXITY_INDICATORS)) {
    const matches = task.match(indicator.pattern);
    if (matches) {
      score += matches.length * indicator.weight;
    }
  }

  // Check task length (longer = more complex)
  const words = task.split(/\s+/).length;
  if (words > 50) score += 2;
  else if (words > 25) score += 1;

  // Check for multiple task types
  const matchedTypes = Object.entries(TASK_PATTERNS)
    .filter(([_, config]) => config.pattern.test(task))
    .length;
  if (matchedTypes > 2) score += 2;
  else if (matchedTypes > 1) score += 1;

  // Clamp to 1-10 range
  return Math.min(10, Math.max(1, Math.round(score)));
}

/**
 * Detect the primary task type
 *
 * @param {string} task - Task description
 * @returns {object} Task type info
 */
export function detectTaskType(task) {
  for (const [type, config] of Object.entries(TASK_PATTERNS)) {
    if (config.pattern.test(task)) {
      return {
        type,
        priority: config.priority,
        agentType: config.agentType,
      };
    }
  }

  return {
    type: 'general',
    priority: PRIORITY.NORMAL,
    agentType: 'general',
  };
}

/**
 * Extract distinct actions from a task description
 *
 * @param {string} task - Task description
 * @returns {string[]} Array of action descriptions
 */
export function extractActions(task) {
  const actions = [];

  // Split by common conjunctions
  const parts = task.split(/\band\b|\bthen\b|\balso\b|,\s*(?=\w)/i);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 10) { // Ignore very short fragments
      actions.push(trimmed);
    }
  }

  // If no splits found, return the whole task
  if (actions.length === 0) {
    actions.push(task);
  }

  return actions;
}

/**
 * Group actions by type for optimal subtask creation
 *
 * @param {string[]} actions - Array of action descriptions
 * @returns {object} Grouped actions
 */
export function groupActionsByType(actions) {
  const groups = {
    security: [],
    bugfix: [],
    review: [],
    refactor: [],
    test: [],
    docs: [],
    issues: [],
    general: [],
  };

  for (const action of actions) {
    const { type } = detectTaskType(action);
    groups[type].push(action);
  }

  return groups;
}

/**
 * Split a complex task into subtasks
 *
 * @param {string} task - Task description
 * @param {object} options - Options
 * @param {number} options.maxSubtasks - Maximum subtasks (default: 3)
 * @param {number} options.priorityThreshold - Priority threshold
 * @param {object} options.context - Additional context
 * @returns {object} Split result with subtasks and dependencies
 */
export function splitTask(task, options = {}) {
  const maxSubtasks = Math.min(options.maxSubtasks || MAX_SUBTASKS, MAX_SUBTASKS);
  const priorityThreshold = options.priorityThreshold || PRIORITY.LOW;

  // Get complexity
  const complexity = detectComplexity(task);

  // If simple enough, return as single subtask
  if (complexity <= COMPLEXITY.SIMPLE) {
    const taskType = detectTaskType(task);
    return {
      complexity,
      subtasks: [{
        description: task,
        priority: taskType.priority,
        agentType: taskType.agentType,
        dependencies: [],
        input: { task },
      }],
      dependencies: {},
    };
  }

  // Extract and group actions
  const actions = extractActions(task);
  const groups = groupActionsByType(actions);

  // Build subtasks from groups
  const subtasks = [];
  const dependencies = {};

  // Priority order for processing groups
  const priorityOrder = ['security', 'bugfix', 'review', 'refactor', 'test', 'docs', 'issues', 'general'];

  for (const groupType of priorityOrder) {
    const groupActions = groups[groupType];
    if (groupActions.length === 0) continue;

    // Skip if already at max
    if (subtasks.length >= maxSubtasks) break;

    const typeConfig = TASK_PATTERNS[groupType] || {
      priority: PRIORITY.NORMAL,
      agentType: 'general',
    };

    // Skip if below priority threshold
    if (typeConfig.priority > priorityThreshold) continue;

    // Combine actions of same type into one subtask
    const description = groupActions.length > 1
      ? `${capitalize(groupType)}: ${groupActions.join(', ')}`
      : groupActions[0];

    const subtaskId = `st_${subtasks.length + 1}`;
    const subtaskDeps = [];

    // Security and bugfix depend on review if review exists
    if ((groupType === 'security' || groupType === 'bugfix') && groups.review.length > 0) {
      const reviewSubtask = subtasks.find(st => st.description.toLowerCase().includes('review'));
      if (reviewSubtask) {
        subtaskDeps.push(reviewSubtask.id);
      }
    }

    // Test depends on bugfix if bugfix exists
    if (groupType === 'test') {
      const bugfixSubtask = subtasks.find(st =>
        st.description.toLowerCase().includes('fix') ||
        st.description.toLowerCase().includes('bug'),
      );
      if (bugfixSubtask) {
        subtaskDeps.push(bugfixSubtask.id);
      }
    }

    subtasks.push({
      id: subtaskId,
      description,
      priority: typeConfig.priority,
      agentType: typeConfig.agentType,
      dependencies: subtaskDeps,
      input: {
        task: description,
        originalTask: task,
        groupType,
        actions: groupActions,
      },
    });

    dependencies[subtaskId] = subtaskDeps;
  }

  // If we ended up with no subtasks, create a single general one
  if (subtasks.length === 0) {
    const taskType = detectTaskType(task);
    subtasks.push({
      id: 'st_1',
      description: task,
      priority: taskType.priority,
      agentType: taskType.agentType,
      dependencies: [],
      input: { task },
    });
  }

  // If we have more than max, consolidate
  while (subtasks.length > maxSubtasks) {
    // Merge last two subtasks
    const last = subtasks.pop();
    const secondLast = subtasks[subtasks.length - 1];

    secondLast.description = `${secondLast.description}; ${last.description}`;
    secondLast.input.actions = [
      ...(secondLast.input.actions || []),
      ...(last.input.actions || []),
    ];

    // Use higher priority
    if (last.priority < secondLast.priority) {
      secondLast.priority = last.priority;
    }
  }

  return {
    complexity,
    subtasks,
    dependencies,
  };
}

/**
 * Analyze a task and suggest optimal splitting strategy
 *
 * @param {string} task - Task description
 * @returns {object} Analysis result
 */
export function analyzeTask(task) {
  const complexity = detectComplexity(task);
  const taskType = detectTaskType(task);
  const actions = extractActions(task);
  const groups = groupActionsByType(actions);

  const activeGroups = Object.entries(groups)
    .filter(([_, actions]) => actions.length > 0)
    .map(([type, actions]) => ({ type, count: actions.length }));

  return {
    complexity,
    complexityLabel: getComplexityLabel(complexity),
    primaryType: taskType.type,
    suggestedAgentType: taskType.agentType,
    suggestedPriority: taskType.priority,
    actionCount: actions.length,
    activeGroups,
    shouldSplit: complexity > COMPLEXITY.SIMPLE,
    suggestedSubtasks: Math.min(MAX_SUBTASKS, Math.ceil(complexity / 3)),
  };
}

/**
 * Get human-readable complexity label
 */
function getComplexityLabel(complexity) {
  if (complexity <= COMPLEXITY.TRIVIAL) return 'trivial';
  if (complexity <= COMPLEXITY.SIMPLE) return 'simple';
  if (complexity <= COMPLEXITY.MODERATE) return 'moderate';
  if (complexity <= COMPLEXITY.COMPLEX) return 'complex';
  return 'very_complex';
}

/**
 * Capitalize first letter
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Check if a task should be auto-split
 *
 * @param {string} task - Task description
 * @param {object} options - Options
 * @returns {boolean} True if task should be split
 */
export function shouldAutoSplit(task, options = {}) {
  const complexity = detectComplexity(task);
  const threshold = options.complexityThreshold || COMPLEXITY.MODERATE;

  return complexity >= threshold;
}

/**
 * Estimate execution time for a task (rough heuristic)
 *
 * @param {string} task - Task description
 * @returns {object} Time estimate
 */
export function estimateExecutionTime(task) {
  const complexity = detectComplexity(task);
  const actions = extractActions(task);

  // Base time per action (in arbitrary units)
  const baseTimePerAction = 30; // seconds
  const complexityMultiplier = 1 + (complexity / 10);

  const estimatedSeconds = actions.length * baseTimePerAction * complexityMultiplier;

  return {
    estimatedSeconds: Math.round(estimatedSeconds),
    estimatedMinutes: Math.round(estimatedSeconds / 60),
    confidence: complexity <= COMPLEXITY.MODERATE ? 'high' : 'low',
    note: complexity > COMPLEXITY.MODERATE
      ? 'Complex tasks may take significantly longer'
      : null,
  };
}

export default {
  splitTask,
  detectComplexity,
  detectTaskType,
  extractActions,
  groupActionsByType,
  analyzeTask,
  shouldAutoSplit,
  estimateExecutionTime,
  MAX_SUBTASKS,
  COMPLEXITY,
};
