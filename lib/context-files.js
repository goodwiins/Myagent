/**
 * GoodFlows Context File Manager
 *
 * Manages structured context files for consistent Claude quality:
 * - PROJECT.md: Project vision (always loaded)
 * - ROADMAP.md: Goals and milestones
 * - STATE.md: Session memory across contexts
 * - PLAN.md: Current atomic task (XML)
 * - SUMMARY.md: Execution history
 * - ISSUES.md: Deferred work queue
 *
 * @module goodflows/lib/context-files
 */

import { promises as fs } from 'fs';
import path from 'path';

/**
 * Size limits in tokens (approximate: 1 token ≈ 4 chars)
 */
export const SIZE_LIMITS = {
  PROJECT: 2000,   // ~8000 chars
  ROADMAP: 3000,   // ~12000 chars
  STATE: 1500,     // ~6000 chars
  PLAN: 1000,      // ~4000 chars
  SUMMARY: 5000,   // ~20000 chars
  ISSUES: 2000,    // ~8000 chars
};

/**
 * Token to character ratio (approximate)
 */
const CHARS_PER_TOKEN = 4;

/**
 * Context file types
 */
export const CONTEXT_FILES = {
  PROJECT: 'PROJECT.md',
  ROADMAP: 'ROADMAP.md',
  STATE: 'STATE.md',
  PLAN: 'PLAN.md',
  SUMMARY: 'SUMMARY.md',
  ISSUES: 'ISSUES.md',
};

/**
 * Auto-load configuration
 */
export const AUTO_LOAD = {
  ALWAYS: ['PROJECT', 'STATE'],           // Always inject into prompts
  ON_PLANNING: ['ROADMAP', 'ISSUES'],     // Load for planning phases
  ON_TASK: ['PLAN'],                       // Load for task execution
  ON_ORCHESTRATOR: ['SUMMARY'],            // Load for orchestrators
};

/**
 * Default templates for each context file
 */
const TEMPLATES = {
  PROJECT: `# Project: [Name]

## Vision
[1-2 sentences: What problem does this solve?]

## Core Principles
- [Principle 1]
- [Principle 2]
- [Principle 3]

## Architecture
[High-level architecture description]

## Key Technologies
- [Tech 1]: [Why]
- [Tech 2]: [Why]

## Boundaries
- DO: [What the project does]
- DON'T: [What it explicitly doesn't do]
`,

  ROADMAP: `# Roadmap

## Current Milestone
**[Milestone Name]** - [Target Date]

### Goals
- [ ] Goal 1
- [ ] Goal 2
- [ ] Goal 3

### Blockers
- None currently

---

## Completed Milestones
*None yet*

---

## Future Milestones
### [Next Milestone]
- [Brief description]
`,

  STATE: `# Current State

## Last Updated
${new Date().toISOString()}

## Active Session
- ID: pending
- Started: pending
- Trigger: pending

## Current Position
[What we're working on right now]

## Recent Decisions
| Decision | Rationale | Date |
|----------|-----------|------|

## Active Blockers
- None currently

## Context for Next Session
[What the next agent/session needs to know]
`,

  PLAN: `<task type="implementation">
  <name>Task name here</name>

  <context>
    <why>Why this task matters</why>
    <depends-on>Prerequisites</depends-on>
    <session>session_id</session>
  </context>

  <scope>
    <files>
      <file action="create">path/to/file.ts</file>
    </files>
    <boundaries>What NOT to touch</boundaries>
  </scope>

  <action>
    Precise instructions:
    - Step 1
    - Step 2
    - Step 3
  </action>

  <verify>
    <check type="command">npm run test</check>
    <check type="manual">Manual verification step</check>
  </verify>

  <done>
    Definition of done
  </done>

  <tracking>
    <goodflows>true</goodflows>
  </tracking>
</task>
`,

  SUMMARY: `# Execution Summary

## Latest Execution
**Date**: ${new Date().toISOString().split('T')[0]}
**Task**: [Task name]
**Status**: pending

### Changes Made
- [No changes yet]

### Verification Results
- [ ] Pending

### Notes
[Observations]

---

## Previous Executions
*No previous executions*
`,

  ISSUES: `# Deferred Issues

## High Priority
*None*

## Normal Priority
*None*

## Low Priority / Ideas
*None*

## Resolved
*None*
`,
};

/**
 * ContextFileManager - Manages structured context files
 */
export class ContextFileManager {
  /**
   * Create a new ContextFileManager
   * @param {object} options - Configuration options
   * @param {string} options.basePath - Base path for .goodflows directory
   */
  constructor(options = {}) {
    this.basePath = options.basePath || process.cwd();
    this.goodflowsPath = path.join(this.basePath, '.goodflows');
    this.todosPath = path.join(this.goodflowsPath, 'todos');
    this._cache = {};
  }

  /**
   * Initialize context file structure
   * Creates .goodflows directory and all context files with templates
   * @param {object} options - Init options
   * @param {boolean} options.force - Overwrite existing files
   * @returns {Promise<object>} Created files
   */
  async init(options = {}) {
    const created = [];
    const skipped = [];

    // Create directories
    await fs.mkdir(this.goodflowsPath, { recursive: true });
    await fs.mkdir(this.todosPath, { recursive: true });

    // Create each context file
    for (const [type, filename] of Object.entries(CONTEXT_FILES)) {
      const filePath = path.join(this.goodflowsPath, filename);
      const exists = await this._exists(filePath);

      if (exists && !options.force) {
        skipped.push(filename);
        continue;
      }

      await fs.writeFile(filePath, TEMPLATES[type], 'utf-8');
      created.push(filename);
    }

    return {
      created,
      skipped,
      path: this.goodflowsPath,
    };
  }

  /**
   * Read a context file
   * @param {string} type - File type (PROJECT, ROADMAP, STATE, PLAN, SUMMARY, ISSUES)
   * @param {object} options - Read options
   * @param {boolean} options.useCache - Use cached version if available
   * @returns {Promise<object>} File content and metadata
   */
  async read(type, options = {}) {
    const normalizedType = type.toUpperCase().replace('.MD', '');
    const filename = CONTEXT_FILES[normalizedType];

    if (!filename) {
      throw new Error(`Unknown context file type: ${type}`);
    }

    const filePath = path.join(this.goodflowsPath, filename);

    // Check cache
    if (options.useCache && this._cache[normalizedType]) {
      return this._cache[normalizedType];
    }

    // Check if file exists
    if (!(await this._exists(filePath))) {
      return {
        type: normalizedType,
        exists: false,
        content: null,
        tokens: 0,
        limit: SIZE_LIMITS[normalizedType],
        withinLimit: true,
      };
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const tokens = this._estimateTokens(content);
    const limit = SIZE_LIMITS[normalizedType];

    const result = {
      type: normalizedType,
      exists: true,
      content,
      tokens,
      limit,
      withinLimit: tokens <= limit,
      overage: tokens > limit ? tokens - limit : 0,
      path: filePath,
      lastModified: (await fs.stat(filePath)).mtime.toISOString(),
    };

    // Cache the result
    this._cache[normalizedType] = result;

    return result;
  }

  /**
   * Write to a context file
   * @param {string} type - File type
   * @param {string} content - Content to write
   * @param {object} options - Write options
   * @returns {Promise<object>} Write result with size info
   */
  async write(type, content, options = {}) {
    const normalizedType = type.toUpperCase().replace('.MD', '');
    const filename = CONTEXT_FILES[normalizedType];

    if (!filename) {
      throw new Error(`Unknown context file type: ${type}`);
    }

    const filePath = path.join(this.goodflowsPath, filename);
    const tokens = this._estimateTokens(content);
    const limit = SIZE_LIMITS[normalizedType];

    // Check size limit
    if (tokens > limit && !options.allowOversize) {
      return {
        success: false,
        error: `Content exceeds size limit: ${tokens} tokens > ${limit} limit`,
        tokens,
        limit,
        suggestion: `Reduce content by ~${tokens - limit} tokens (~${(tokens - limit) * CHARS_PER_TOKEN} chars)`,
      };
    }

    // Ensure directory exists
    await fs.mkdir(this.goodflowsPath, { recursive: true });

    // Write file
    await fs.writeFile(filePath, content, 'utf-8');

    // Clear cache
    delete this._cache[normalizedType];

    return {
      success: true,
      type: normalizedType,
      path: filePath,
      tokens,
      limit,
      withinLimit: tokens <= limit,
      warning: tokens > limit ? `Content exceeds recommended limit by ${tokens - limit} tokens` : null,
    };
  }

  /**
   * Append to a context file
   * @param {string} type - File type
   * @param {string} content - Content to append
   * @param {object} options - Append options
   * @param {string} options.section - Section to append to (for structured files)
   * @returns {Promise<object>} Append result
   */
  async append(type, content, options = {}) {
    const existing = await this.read(type);

    if (!existing.exists) {
      // Create with template + content
      const template = TEMPLATES[type.toUpperCase()] || '';
      return this.write(type, template + '\n' + content, options);
    }

    let newContent;

    if (options.section && existing.content.includes(options.section)) {
      // Insert after section header
      const sectionIndex = existing.content.indexOf(options.section);
      const afterSection = existing.content.indexOf('\n', sectionIndex) + 1;
      newContent =
        existing.content.slice(0, afterSection) +
        content + '\n' +
        existing.content.slice(afterSection);
    } else {
      // Append to end
      newContent = existing.content + '\n' + content;
    }

    return this.write(type, newContent, options);
  }

  /**
   * Update STATE.md with new information
   * @param {object} updates - Updates to apply
   * @returns {Promise<object>} Update result
   */
  async updateState(updates = {}) {
    const state = await this.read('STATE');
    let content = state.exists ? state.content : TEMPLATES.STATE;

    // Update timestamp
    content = content.replace(
      /## Last Updated\n.*/,
      `## Last Updated\n${new Date().toISOString()}`,
    );

    // Update session info
    if (updates.session) {
      content = content.replace(
        /## Active Session\n[\s\S]*?(?=\n## )/,
        `## Active Session\n- ID: ${updates.session.id || 'pending'}\n- Started: ${updates.session.started || 'pending'}\n- Trigger: ${updates.session.trigger || 'pending'}\n\n`,
      );
    }

    // Update position
    if (updates.position) {
      content = content.replace(
        /## Current Position\n[\s\S]*?(?=\n## )/,
        `## Current Position\n${updates.position}\n\n`,
      );
    }

    // Add decision
    if (updates.decision) {
      const decisionRow = `| ${updates.decision.decision} | ${updates.decision.rationale} | ${new Date().toISOString().split('T')[0]} |`;
      content = content.replace(
        /(## Recent Decisions\n\| Decision \| Rationale \| Date \|\n\|----------|-----------|------\|)/,
        `$1\n${decisionRow}`,
      );
    }

    // Update context for next session
    if (updates.nextContext) {
      content = content.replace(
        /## Context for Next Session\n[\s\S]*$/,
        `## Context for Next Session\n${updates.nextContext}`,
      );
    }

    return this.write('STATE', content);
  }

  /**
   * Add an execution entry to SUMMARY.md
   * @param {object} execution - Execution details
   * @returns {Promise<object>} Update result
   */
  async addSummary(execution) {
    const summary = await this.read('SUMMARY');
    const now = new Date().toISOString();

    const entry = `## Latest Execution
**Date**: ${now.split('T')[0]}
**Task**: ${execution.task || 'Unknown task'}
**Status**: ${execution.status || 'unknown'}

### Changes Made
${(execution.changes || []).map(c => `- ${c}`).join('\n') || '- No changes recorded'}

### Verification Results
${(execution.verification || []).map(v => `- [${v.passed ? 'x' : ' '}] ${v.name}`).join('\n') || '- No verification performed'}

### Notes
${execution.notes || 'No notes'}

---

`;

    let content;
    if (summary.exists) {
      // Move current "Latest Execution" to "Previous Executions"
      content = summary.content.replace(
        /## Latest Execution[\s\S]*?(?=## Previous Executions)/,
        entry,
      );

      // Add old latest to previous
      const oldLatest = summary.content.match(/## Latest Execution[\s\S]*?(?=---\n\n## Previous)/);
      if (oldLatest) {
        const previousSection = oldLatest[0].replace('## Latest Execution', '### Execution');
        content = content.replace(
          '## Previous Executions\n',
          `## Previous Executions\n\n${previousSection}\n`,
        );
      }
    } else {
      content = entry + '\n## Previous Executions\n*No previous executions*\n';
    }

    // Check size and archive if needed
    const tokens = this._estimateTokens(content);
    if (tokens > SIZE_LIMITS.SUMMARY) {
      content = await this._archiveOldSummaries(content);
    }

    return this.write('SUMMARY', content, { allowOversize: true });
  }

  /**
   * Get auto-load context for agent prompts
   * @param {object} options - Options
   * @param {string} options.agentType - Type of agent (orchestrator, fixer, etc.)
   * @param {boolean} options.isPlanning - Whether in planning phase
   * @param {boolean} options.hasTask - Whether there's an active task
   * @returns {Promise<string>} Combined context content
   */
  async getAutoLoadContext(options = {}) {
    const parts = [];
    const filesToLoad = new Set(AUTO_LOAD.ALWAYS);

    if (options.isPlanning) {
      AUTO_LOAD.ON_PLANNING.forEach(f => filesToLoad.add(f));
    }

    if (options.hasTask) {
      AUTO_LOAD.ON_TASK.forEach(f => filesToLoad.add(f));
    }

    if (options.agentType?.includes('orchestrator')) {
      AUTO_LOAD.ON_ORCHESTRATOR.forEach(f => filesToLoad.add(f));
    }

    let totalTokens = 0;

    for (const type of filesToLoad) {
      const file = await this.read(type);
      if (file.exists && file.content) {
        // Check if adding this would exceed reasonable limit
        if (totalTokens + file.tokens > 6000) {
          parts.push(`\n<!-- ${type}.md truncated due to context budget -->\n`);
          continue;
        }

        parts.push(`\n<!-- BEGIN ${type}.md -->\n`);
        parts.push(file.content);
        parts.push(`\n<!-- END ${type}.md -->\n`);
        totalTokens += file.tokens;
      }
    }

    // Properly resolve async filter for filesLoaded
    const loadedFiles = [];
    for (const type of filesToLoad) {
      const file = await this.read(type);
      if (file.exists) {
        loadedFiles.push(type);
      }
    }

    return {
      content: parts.join('\n'),
      tokens: totalTokens,
      filesLoaded: loadedFiles,
    };
  }

  /**
   * Get status of all context files
   * @returns {Promise<object>} Status of all files
   */
  async status() {
    const files = {};
    let totalTokens = 0;

    for (const [type, filename] of Object.entries(CONTEXT_FILES)) {
      const file = await this.read(type);
      files[type] = {
        filename,
        exists: file.exists,
        tokens: file.tokens || 0,
        limit: SIZE_LIMITS[type],
        usage: file.exists ? `${Math.round((file.tokens / SIZE_LIMITS[type]) * 100)}%` : '0%',
        withinLimit: file.withinLimit,
        lastModified: file.lastModified || null,
      };
      totalTokens += file.tokens || 0;
    }

    return {
      files,
      totalTokens,
      autoLoadBudget: {
        used: totalTokens,
        limit: 6000,
        remaining: 6000 - totalTokens,
      },
      health: this._calculateHealth(files),
    };
  }

  /**
   * Calculate health score for context files
   */
  _calculateHealth(files) {
    let score = 100;
    const issues = [];

    // Check if critical files exist
    if (!files.PROJECT?.exists) {
      score -= 20;
      issues.push('PROJECT.md missing');
    }
    if (!files.STATE?.exists) {
      score -= 15;
      issues.push('STATE.md missing');
    }

    // Check for oversized files
    for (const [type, info] of Object.entries(files)) {
      if (info.exists && !info.withinLimit) {
        score -= 10;
        issues.push(`${type}.md exceeds size limit`);
      }
    }

    // Check for stale STATE.md (older than 24 hours)
    if (files.STATE?.lastModified) {
      const age = Date.now() - new Date(files.STATE.lastModified).getTime();
      if (age > 24 * 60 * 60 * 1000) {
        score -= 5;
        issues.push('STATE.md may be stale');
      }
    }

    return {
      score: Math.max(0, score),
      status: score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'critical',
      issues,
    };
  }

  /**
   * Archive old summary entries
   */
  async _archiveOldSummaries(content) {
    // Keep only last 10 executions
    const executions = content.split(/(?=### Execution)/);
    if (executions.length > 11) {
      const archived = executions.slice(11);
      const archivePath = path.join(this.goodflowsPath, 'summary-archive.md');

      // Append to archive
      await fs.appendFile(
        archivePath,
        `\n# Archived: ${new Date().toISOString()}\n\n${archived.join('\n')}`,
        'utf-8',
      );

      // Return trimmed content
      return executions.slice(0, 11).join('');
    }
    return content;
  }

  /**
   * Estimate token count from text
   */
  _estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Check if file exists
   */
  async _exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a new ContextFileManager instance
 * @param {object} options - Configuration options
 * @returns {ContextFileManager} Manager instance
 */
export function createContextFileManager(options = {}) {
  return new ContextFileManager(options);
}

export default {
  ContextFileManager,
  createContextFileManager,
  CONTEXT_FILES,
  SIZE_LIMITS,
  AUTO_LOAD,
};
