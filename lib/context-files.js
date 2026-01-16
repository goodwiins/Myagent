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
 * Updated for GSD integration spec
 */
const TEMPLATES = {
  PROJECT: `# Project: [Name]

## Vision
[1-2 sentences: What problem does this solve?]

## Core Value
[The ONE thing this project must do well]

## Architecture
[High-level architecture]

## Tech Stack
| Technology | Purpose | Notes |
|------------|---------|-------|
| [Tech]     | [Why]   | [Any constraints] |

## Key Decisions
| Decision | Rationale | Date | Phase |
|----------|-----------|------|-------|

## Boundaries
### DO
- [What project does]

### DON'T
- [What it explicitly doesn't do]

## External Dependencies
- [Dependency]: [Version] - [Purpose]
`,

  ROADMAP: `# Roadmap

## Current Milestone: [Name]
**Target**: [Date]
**Progress**: [░░░░░░░░░░] 0%

## Phases

### Phase 1: Foundation
- **Status**: pending
- **Plans**: 0/0 (not planned)
- **Goal**: [What this phase achieves]

---

## Completed Milestones
*None yet*

---

## Phase Dependencies

\`\`\`
Phase 1 ──► Phase 2
              │
              ▼
         Phase 3 ──► Phase 4
\`\`\`
`,

  STATE: `# Project State

## Project Reference
See: .goodflows/PROJECT.md (updated ${new Date().toISOString().split('T')[0]})
**Core value**: [One-liner from PROJECT.md]
**Current focus**: Phase 1 - Foundation

## Current Position
- **Phase**: 1 of 1 (Foundation)
- **Plan**: 0 of 0 in current phase
- **Status**: Ready to plan
- **Last activity**: ${new Date().toISOString().split('T')[0]} — Initial setup

Progress: [░░░░░░░░░░] 0%

## Performance Metrics
**Velocity:**
- Total plans completed: 0
- Average duration: N/A
- Total execution time: 0 hours

**By Phase:**
| Phase | Plans | Total Time | Avg/Plan |
|-------|-------|------------|----------|

## Accumulated Context

### Recent Decisions
*None yet*

### Deferred Issues
*None - see ISSUES.md*

### Active Blockers
- None currently

## Session Continuity
- **Last session**: ${new Date().toISOString()}
- **Stopped at**: Initial setup
- **Resume file**: None
`,

  PLAN: `---
phase: 01-foundation
plan: 01
type: execute
depends_on: []
files_modified: []
---

<objective>
[What this plan accomplishes]

Purpose: [Why this matters]
Output: [What artifacts will be created]
</objective>

<execution_context>
@.goodflows/workflows/execute-plan.md
@.goodflows/templates/summary.md
</execution_context>

<context>
@.goodflows/PROJECT.md
@.goodflows/ROADMAP.md
@.goodflows/STATE.md
</context>

<tasks>

<task type="auto" id="task-1">
  <name>Task 1: [Action-oriented name]</name>
  <files>path/to/file.ext</files>
  <action>
    [Specific implementation instructions]
    - What to do
    - How to do it
    - What to avoid and WHY
  </action>
  <verify>[Command or check to prove it worked]</verify>
  <done>[Measurable acceptance criteria]</done>
</task>

</tasks>

<verification>
Before declaring complete:
- [ ] [Test command passes]
- [ ] [Build succeeds]
- [ ] [Behavior verified]
</verification>

<success_criteria>
- All tasks completed
- All verification checks pass
</success_criteria>
`,

  SUMMARY: `---
phase: 01-foundation
plan: 01
subsystem: core
tags: []

requires:
  - phase: none
    provides: none
provides:
  - [what this plan delivers]
affects: []

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: []

key-decisions: []

patterns-established: []

issues-created: []

duration: 0min
completed: pending
---

# Phase 1 Plan 1: [Name] Summary

**[Substantive one-liner - what shipped, not "phase complete"]**

## Performance
- **Duration**: pending
- **Started**: pending
- **Completed**: pending
- **Tasks**: 0
- **Files modified**: 0

## Accomplishments
- [Key outcome 1]

## Task Commits
Each task committed atomically:

*No tasks completed yet*

## Files Created/Modified
*None yet*

## Decisions Made
*None*

## Deviations from Plan

### Auto-fixed Issues
*None*

### Deferred Enhancements
*None*

## Issues Encountered
*None*

## Next Phase Readiness
[What's ready, blockers, concerns]

---
*Completed: pending*
`,

  ISSUES: `# Deferred Issues

## Open Issues
*None*

## Resolved Issues
*None*

---

## Issue Statistics
- Open: 0
- Resolved: 0
- By Type: enhancement (0), bug (0), tech-debt (0)
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
   * If project already exists, analyzes it to generate accurate context
   * @param {object} options - Init options
   * @param {boolean} options.force - Overwrite existing files
   * @param {boolean} options.analyze - Analyze existing project (default: true)
   * @returns {Promise<object>} Created files
   */
  async init(options = {}) {
    const created = [];
    const skipped = [];
    const analyze = options.analyze !== false;

    // Create directories
    await fs.mkdir(this.goodflowsPath, { recursive: true });
    await fs.mkdir(this.todosPath, { recursive: true });

    // Analyze existing project if it exists
    let projectInfo = null;
    if (analyze) {
      projectInfo = await this._analyzeExistingProject();
    }

    // Generate templates based on project analysis
    const templates = projectInfo?.detected
      ? this._generateProjectSpecificTemplates(projectInfo)
      : TEMPLATES;

    // Create each context file
    for (const [type, filename] of Object.entries(CONTEXT_FILES)) {
      const filePath = path.join(this.goodflowsPath, filename);
      const exists = await this._exists(filePath);

      if (exists && !options.force) {
        skipped.push(filename);
        continue;
      }

      await fs.writeFile(filePath, templates[type], 'utf-8');
      created.push(filename);
    }

    return {
      created,
      skipped,
      path: this.goodflowsPath,
      projectAnalysis: projectInfo?.detected ? {
        name: projectInfo.name,
        type: projectInfo.type,
        stack: projectInfo.stack,
        detected: true,
      } : { detected: false },
    };
  }

  /**
   * Analyze existing project to generate accurate context
   * @returns {Promise<object|null>} Project info or null if not detected
   */
  async _analyzeExistingProject() {
    const info = {
      detected: false,
      name: 'Unknown Project',
      version: '0.0.0',
      description: '',
      type: 'unknown',
      stack: [],
      hasTests: false,
      hasCI: false,
      hasDocs: false,
      mainFiles: [],
      architecture: '',
      boundaries: { do: [], dont: [] },
    };

    // Try to read package.json
    const packageJsonPath = path.join(this.basePath, 'package.json');
    if (await this._exists(packageJsonPath)) {
      try {
        const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        info.detected = true;
        info.name = pkg.name || 'Unknown';
        info.version = pkg.version || '0.0.0';
        info.description = pkg.description || '';
        info.type = this._detectProjectType(pkg);
        info.stack = this._extractStack(pkg);
        info.hasTests = !!(pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1');

        // Detect architecture from dependencies
        if (pkg.dependencies?.['@modelcontextprotocol/sdk']) {
          info.architecture = 'MCP Server';
        } else if (pkg.dependencies?.express || pkg.dependencies?.fastify) {
          info.architecture = 'REST API';
        } else if (pkg.dependencies?.react || pkg.dependencies?.vue) {
          info.architecture = 'Frontend SPA';
        } else if (pkg.bin) {
          info.architecture = 'CLI Tool';
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check for README
    const readmePath = path.join(this.basePath, 'README.md');
    if (await this._exists(readmePath)) {
      info.hasDocs = true;
      try {
        const readme = await fs.readFile(readmePath, 'utf-8');
        // Extract key info from README
        if (!info.description && readme.length > 50) {
          // Get first non-empty, non-header line
          const lines = readme.split('\n');
          for (const line of lines) {
            if (line && !line.startsWith('#') && !line.startsWith('[![') && line.length > 20) {
              info.description = line.slice(0, 200);
              break;
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    // Check for CI
    info.hasCI = await this._exists(path.join(this.basePath, '.github/workflows')) ||
                 await this._exists(path.join(this.basePath, '.gitlab-ci.yml')) ||
                 await this._exists(path.join(this.basePath, '.circleci'));

    // Check for test directories
    info.hasTests = info.hasTests ||
                    await this._exists(path.join(this.basePath, 'tests')) ||
                    await this._exists(path.join(this.basePath, '__tests__')) ||
                    await this._exists(path.join(this.basePath, 'test'));

    // Detect main source directories
    const srcDirs = ['src', 'lib', 'app', 'bin', 'packages'];
    for (const dir of srcDirs) {
      if (await this._exists(path.join(this.basePath, dir))) {
        info.mainFiles.push(dir);
      }
    }

    return info;
  }

  /**
   * Detect project type from package.json
   */
  _detectProjectType(pkg) {
    if (pkg.bin) return 'cli';
    if (pkg.main?.includes('server') || pkg.name?.includes('server')) return 'server';
    if (pkg.dependencies?.react || pkg.dependencies?.vue || pkg.dependencies?.svelte) return 'frontend';
    if (pkg.dependencies?.express || pkg.dependencies?.fastify || pkg.dependencies?.koa) return 'backend';
    if (pkg.type === 'module') return 'library';
    return 'application';
  }

  /**
   * Extract tech stack from package.json
   */
  _extractStack(pkg) {
    const stack = [];
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Runtime
    if (pkg.engines?.node) stack.push(`Node.js ${pkg.engines.node}`);
    if (pkg.type === 'module') stack.push('ES Modules');

    // Frameworks
    if (allDeps['@modelcontextprotocol/sdk']) stack.push('MCP SDK');
    if (allDeps.express) stack.push('Express');
    if (allDeps.fastify) stack.push('Fastify');
    if (allDeps.react) stack.push('React');
    if (allDeps.vue) stack.push('Vue');

    // Testing
    if (allDeps.vitest) stack.push('Vitest');
    if (allDeps.jest) stack.push('Jest');
    if (allDeps.mocha) stack.push('Mocha');

    // Linting/Quality
    if (allDeps.eslint) stack.push('ESLint');
    if (allDeps.typescript) stack.push('TypeScript');

    return stack;
  }

  /**
   * Generate project-specific templates based on analysis
   */
  _generateProjectSpecificTemplates(info) {
    const templates = { ...TEMPLATES };
    const now = new Date().toISOString().split('T')[0];

    // Generate PROJECT.md based on analysis
    templates.PROJECT = `# Project: ${info.name}

## Vision
${info.description || '[Description not found - update from README]'}

## Core Value
[Define the ONE thing this project must do well]

## Architecture
${info.architecture || 'Standard application architecture'}

## Tech Stack
| Technology | Purpose | Notes |
|------------|---------|-------|
${info.stack.map(tech => `| ${tech} | Core | |`).join('\n') || '| Node.js | Runtime | |'}

## Key Decisions
| Decision | Rationale | Date | Phase |
|----------|-----------|------|-------|

## Boundaries
### DO
${info.mainFiles.length > 0 ? info.mainFiles.map(f => `- Code in \`${f}/\``).join('\n') : '- [Define what project does]'}

### DON'T
- [Define what it explicitly doesn't do]

## External Dependencies
${info.stack.slice(0, 5).map(s => `- ${s}`).join('\n') || '- None specified'}
`;

    // Generate STATE.md with project context
    templates.STATE = `# Project State

## Project Reference
See: .goodflows/PROJECT.md (updated ${now})
**Core value**: ${info.description?.slice(0, 100) || '[Define from PROJECT.md]'}
**Current focus**: Initial setup

## Current Position
- **Phase**: Not started
- **Plan**: None
- **Status**: Ready to plan
- **Last activity**: ${now} — Context files initialized

Progress: [░░░░░░░░░░] 0%

## Performance Metrics
**Velocity:**
- Total plans completed: 0
- Average duration: N/A
- Total execution time: 0 hours

**By Phase:**
| Phase | Plans | Total Time | Avg/Plan |
|-------|-------|------------|----------|

## Accumulated Context

### Recent Decisions
*None yet*

### Deferred Issues
*None - see ISSUES.md*

### Active Blockers
- None currently

## Session Continuity
- **Last session**: ${new Date().toISOString()}
- **Stopped at**: Initial setup
- **Resume file**: None
`;

    // Generate ROADMAP.md
    templates.ROADMAP = `# Roadmap

## Current Milestone: v${info.version || '1.0.0'}
**Target**: [Set target date]
**Progress**: [░░░░░░░░░░] 0%

## Phases

### Phase 1: [Define First Phase]
- **Status**: pending
- **Plans**: 0/0 (not planned)
- **Goal**: [What this phase achieves]

---

## Completed Milestones
${info.version && info.version !== '0.0.0' ? `### v${info.version}\n- Current stable release` : '*None yet*'}

---

## Phase Dependencies

\`\`\`
Phase 1 ──► Phase 2
\`\`\`
`;

    return templates;
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

    // Validate project context before loading
    const validation = await this._validateProjectContext();

    // If there's a mismatch, prepend a warning to the context
    if (!validation.valid && validation.mismatchType) {
      parts.push(`\n<!-- WARNING: ${validation.mismatchType} -->\n`);
      parts.push(`<!-- ${validation.suggestion} -->\n`);
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
      validation: {
        valid: validation.valid,
        projectMdName: validation.projectMdName,
        packageJsonName: validation.packageJsonName,
        mismatchType: validation.mismatchType,
        suggestion: validation.suggestion,
      },
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
   * Parse project name from PROJECT.md content
   * Looks for "# Project: {name}" pattern
   * @param {string} content - PROJECT.md content
   * @returns {string|null} Project name or null if not found
   */
  _parseProjectNameFromContent(content) {
    if (!content) return null;

    // Match "# Project: Name" or "# Project: Name (version)" patterns
    const match = content.match(/^#\s*Project:\s*(.+?)(?:\s*\(|$)/m);
    if (match && match[1]) {
      return match[1].trim();
    }

    // Fallback: try to match just "# Name" at start
    const headerMatch = content.match(/^#\s+([^#\n]+)/m);
    if (headerMatch && headerMatch[1]) {
      const name = headerMatch[1].trim();
      // Filter out template placeholders
      if (name !== '[Name]' && !name.startsWith('[')) {
        return name;
      }
    }

    return null;
  }

  /**
   * Get project name from package.json
   * @returns {Promise<string|null>} Project name or null if not found
   */
  async _getPackageJsonName() {
    const packageJsonPath = path.join(this.basePath, 'package.json');
    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      return pkg.name || null;
    } catch {
      return null;
    }
  }

  /**
   * Validate that PROJECT.md matches the current project
   * Compares PROJECT.md project name with package.json name
   * @returns {Promise<object>} Validation result
   */
  async _validateProjectContext() {
    const projectFile = await this.read('PROJECT');
    const projectMdName = this._parseProjectNameFromContent(projectFile.content);
    const packageJsonName = await this._getPackageJsonName();

    // Normalize names for comparison (case-insensitive, handle common variations)
    const normalize = (name) => {
      if (!name) return null;
      return name.toLowerCase()
        .replace(/[_-]/g, '')  // goodflows, good-flows, good_flows -> goodflows
        .replace(/\s+/g, '');  // remove spaces
    };

    const normalizedProjectMd = normalize(projectMdName);
    const normalizedPackageJson = normalize(packageJsonName);

    // Check for match
    const isMatch = normalizedProjectMd && normalizedPackageJson &&
      (normalizedProjectMd === normalizedPackageJson ||
       normalizedProjectMd.includes(normalizedPackageJson) ||
       normalizedPackageJson.includes(normalizedProjectMd));

    // Determine mismatch type
    let mismatchType = null;
    if (!projectFile.exists) {
      mismatchType = 'PROJECT_MISSING';
    } else if (!projectMdName || projectMdName === '[Name]') {
      mismatchType = 'PROJECT_NOT_INITIALIZED';
    } else if (!packageJsonName) {
      mismatchType = 'PACKAGE_JSON_MISSING';
    } else if (!isMatch) {
      mismatchType = 'PROJECT_MISMATCH';
    }

    return {
      valid: isMatch || mismatchType === 'PACKAGE_JSON_MISSING', // OK if no package.json
      projectMdName,
      packageJsonName,
      mismatchType,
      suggestion: mismatchType === 'PROJECT_MISMATCH'
        ? `PROJECT.md describes "${projectMdName}" but package.json is "${packageJsonName}". Run goodflows_context_file_init({ force: true }) to reinitialize.`
        : mismatchType === 'PROJECT_NOT_INITIALIZED'
          ? 'PROJECT.md not initialized. Run goodflows_context_file_init() to set up context files.'
          : mismatchType === 'PROJECT_MISSING'
            ? 'No PROJECT.md found. Run goodflows_context_file_init() to create context files.'
            : null,
    };
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
