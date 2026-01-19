/**
 * GoodFlows Auto-Context Detection
 *
 * Intelligent context loading based on task type and keywords.
 * Reduces token usage by only loading relevant context files.
 *
 * @module goodflows/lib/auto-context
 */

import { createContextFileManager, SIZE_LIMITS, CONTEXT_FILES } from './context-files.js';

/**
 * Token budget for auto-loaded context (6K tokens ≈ 24K chars)
 */
const AUTO_CONTEXT_BUDGET = 6000;
const CHARS_PER_TOKEN = 4;

/**
 * Keyword patterns mapped to context file needs
 */
export const KEYWORD_PATTERNS = {
  // Bug fixing / error resolution
  fix: ['STATE', 'PLAN'],
  bug: ['STATE', 'PLAN'],
  error: ['STATE', 'PLAN'],
  debug: ['STATE', 'PLAN'],
  broken: ['STATE', 'PLAN'],
  failing: ['STATE', 'PLAN'],
  crash: ['STATE', 'PLAN'],
  issue: ['STATE', 'PLAN', 'ISSUES'],

  // Planning / design
  plan: ['ROADMAP', 'ISSUES'],
  design: ['ROADMAP', 'ISSUES', 'PROJECT'],
  architect: ['ROADMAP', 'PROJECT'],
  strategy: ['ROADMAP', 'PROJECT'],
  roadmap: ['ROADMAP'],
  milestone: ['ROADMAP'],
  phase: ['ROADMAP', 'STATE'],

  // Feature implementation
  implement: ['PROJECT', 'ROADMAP', 'PLAN'],
  feature: ['PROJECT', 'ROADMAP'],
  add: ['PROJECT', 'STATE'],
  create: ['PROJECT', 'STATE'],
  build: ['PROJECT', 'ROADMAP'],
  new: ['PROJECT', 'ROADMAP'],

  // Review / testing
  review: ['STATE', 'SUMMARY'],
  test: ['STATE', 'SUMMARY'],
  verify: ['STATE', 'PLAN'],
  check: ['STATE'],
  audit: ['STATE', 'SUMMARY', 'ISSUES'],

  // Refactoring
  refactor: ['STATE', 'PLAN'],
  cleanup: ['STATE', 'ISSUES'],
  optimize: ['STATE', 'PLAN'],
  improve: ['STATE', 'ISSUES'],

  // Documentation
  document: ['PROJECT', 'SUMMARY'],
  docs: ['PROJECT', 'SUMMARY'],
  readme: ['PROJECT'],

  // Status / progress
  status: ['STATE', 'ROADMAP'],
  progress: ['STATE', 'ROADMAP', 'SUMMARY'],
  where: ['STATE'],
  what: ['STATE', 'PROJECT'],

  // Resume / continue
  resume: ['STATE', 'PLAN'],
  continue: ['STATE', 'PLAN'],
  pick: ['STATE', 'PLAN'],
};

/**
 * Detect which context files are needed based on task description
 *
 * @param {string} task - Task description or prompt
 * @returns {object} Detection result with needed files and confidence
 *
 * @example
 * const needs = detectContextNeeds('Fix the authentication bug');
 * // Returns: { files: ['PROJECT', 'STATE', 'PLAN'], confidence: 0.85, matchedKeywords: ['fix', 'bug'] }
 */
export function detectContextNeeds(task) {
  if (!task || typeof task !== 'string') {
    return {
      files: ['PROJECT', 'STATE'],
      confidence: 0.5,
      matchedKeywords: [],
      reason: 'Default context (no task provided)',
    };
  }

  const taskLower = task.toLowerCase();
  const matchedKeywords = [];
  const neededFiles = new Set(['PROJECT', 'STATE']); // Always include these

  // Find all matching keywords
  for (const [keyword, files] of Object.entries(KEYWORD_PATTERNS)) {
    // Check for word boundary matches to avoid partial matches
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(taskLower)) {
      matchedKeywords.push(keyword);
      files.forEach(file => neededFiles.add(file));
    }
  }

  // Calculate confidence based on keyword matches
  const confidence = Math.min(0.5 + matchedKeywords.length * 0.15, 0.95);

  // Sort files by priority (most important first)
  const filePriority = ['PROJECT', 'STATE', 'PLAN', 'ROADMAP', 'ISSUES', 'SUMMARY'];
  const sortedFiles = Array.from(neededFiles).sort(
    (a, b) => filePriority.indexOf(a) - filePriority.indexOf(b),
  );

  return {
    files: sortedFiles,
    confidence,
    matchedKeywords,
    reason: matchedKeywords.length > 0
      ? `Matched keywords: ${matchedKeywords.join(', ')}`
      : 'Default context (no keywords matched)',
  };
}

/**
 * Auto-load context files based on task description
 *
 * Loads only the files needed for the task while staying within token budget.
 *
 * @param {string} task - Task description or prompt
 * @param {object} options - Options
 * @param {string} [options.basePath='.goodflows'] - Base path for context files
 * @param {number} [options.budgetTokens=6000] - Token budget for context
 * @param {boolean} [options.includeMetadata=true] - Include file headers
 * @returns {Promise<object>} Loaded context with content and stats
 *
 * @example
 * const context = await autoLoadContext('Fix the auth bug', { budgetTokens: 4000 });
 * console.log(context.content); // Combined context content
 * console.log(context.stats.tokensSaved); // Tokens saved vs full load
 */
export async function autoLoadContext(task, options = {}) {
  const {
    basePath = '.goodflows',
    budgetTokens = AUTO_CONTEXT_BUDGET,
    includeMetadata = true,
  } = options;

  const detection = detectContextNeeds(task);
  const budgetChars = budgetTokens * CHARS_PER_TOKEN;

  // Create context file manager with the provided base path
  const contextManager = createContextFileManager({ basePath });

  const loadedFiles = [];
  const skippedFiles = [];
  let totalChars = 0;
  const contentParts = [];

  // Load files in priority order until budget is exhausted
  for (const fileType of detection.files) {
    const fileName = CONTEXT_FILES[fileType];
    const fileLimit = SIZE_LIMITS[fileType] * CHARS_PER_TOKEN;

    try {
      const result = await contextManager.read(fileType);

      if (!result.exists || !result.content) {
        skippedFiles.push({ file: fileType, reason: 'not found' });
        continue;
      }

      const content = result.content;
      const contentChars = content.length;

      // Check if adding this file exceeds budget
      if (totalChars + contentChars > budgetChars) {
        // Try to include truncated version
        const remainingChars = budgetChars - totalChars;
        if (remainingChars > 500) {
          // Only include if we can get meaningful content
          const truncated = content.slice(0, remainingChars - 50) + '\n\n... (truncated)';
          contentParts.push(formatFileContent(fileType, truncated, includeMetadata));
          loadedFiles.push({
            file: fileType,
            chars: truncated.length,
            tokens: Math.ceil(truncated.length / CHARS_PER_TOKEN),
            truncated: true,
          });
          totalChars += truncated.length;
        } else {
          skippedFiles.push({ file: fileType, reason: 'budget exceeded' });
        }
        continue;
      }

      contentParts.push(formatFileContent(fileType, content, includeMetadata));
      loadedFiles.push({
        file: fileType,
        chars: contentChars,
        tokens: Math.ceil(contentChars / CHARS_PER_TOKEN),
        truncated: false,
      });
      totalChars += contentChars;

    } catch (error) {
      skippedFiles.push({ file: fileType, reason: error.message });
    }
  }

  // Calculate tokens saved
  const allFilesTokens = Object.values(SIZE_LIMITS).reduce((sum, limit) => sum + limit, 0);
  const actualTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
  const tokensSaved = Math.max(0, allFilesTokens - actualTokens);
  const savingsPercent = allFilesTokens > 0
    ? Math.round((tokensSaved / allFilesTokens) * 100)
    : 0;

  return {
    content: contentParts.join('\n\n---\n\n'),
    detection,
    stats: {
      filesLoaded: loadedFiles.length,
      filesSkipped: skippedFiles.length,
      totalChars,
      totalTokens: actualTokens,
      budgetTokens,
      budgetUsedPercent: Math.round((actualTokens / budgetTokens) * 100),
      tokensSaved,
      savingsPercent,
    },
    loadedFiles,
    skippedFiles,
  };
}

/**
 * Format file content with optional header
 */
function formatFileContent(fileType, content, includeMetadata) {
  if (!includeMetadata) {
    return content;
  }

  return `<!-- Context: ${fileType}.md -->\n${content}`;
}

/**
 * Get context loading recommendations for a task
 *
 * @param {string} task - Task description
 * @returns {object} Recommendations for context loading
 */
export function getContextRecommendations(task) {
  const detection = detectContextNeeds(task);

  const recommendations = [];

  if (detection.files.includes('PLAN') && !detection.files.includes('STATE')) {
    recommendations.push('Consider loading STATE.md for execution context');
  }

  if (detection.matchedKeywords.includes('resume') || detection.matchedKeywords.includes('continue')) {
    recommendations.push('This appears to be a resume task - STATE.md and PLAN.md are critical');
  }

  if (detection.files.length > 4) {
    recommendations.push('Many context files needed - consider breaking task into smaller steps');
  }

  return {
    ...detection,
    recommendations,
    estimatedTokens: detection.files.reduce(
      (sum, file) => sum + (SIZE_LIMITS[file] || 0),
      0,
    ),
  };
}

/**
 * Categorize a task type based on keywords
 *
 * @param {string} task - Task description
 * @returns {string} Task category
 */
export function categorizeTask(task) {
  const detection = detectContextNeeds(task);
  const keywords = detection.matchedKeywords;

  // Check resume/continue first as they are high-intent actions
  if (keywords.some(k => ['resume', 'continue', 'pick'].includes(k))) {
    return 'resume';
  }
  if (keywords.some(k => ['fix', 'bug', 'error', 'debug', 'broken'].includes(k))) {
    return 'bug-fix';
  }
  if (keywords.some(k => ['plan', 'design', 'architect', 'strategy'].includes(k))) {
    return 'planning';
  }
  if (keywords.some(k => ['implement', 'feature', 'add', 'create', 'build'].includes(k))) {
    return 'implementation';
  }
  if (keywords.some(k => ['review', 'test', 'verify', 'audit'].includes(k))) {
    return 'review';
  }
  if (keywords.some(k => ['refactor', 'cleanup', 'optimize'].includes(k))) {
    return 'refactoring';
  }
  if (keywords.some(k => ['document', 'docs', 'readme'].includes(k))) {
    return 'documentation';
  }
  if (keywords.some(k => ['status', 'progress', 'where'].includes(k))) {
    return 'status-check';
  }

  return 'general';
}

export default {
  detectContextNeeds,
  autoLoadContext,
  getContextRecommendations,
  categorizeTask,
  KEYWORD_PATTERNS,
  AUTO_CONTEXT_BUDGET,
};
