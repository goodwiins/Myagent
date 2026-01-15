/**
 * GoodFlows Phase Manager
 *
 * Manages phase directories, PLAN.md files, and SUMMARY.md files
 * according to the GSD integration spec.
 *
 * Directory structure:
 * .goodflows/
 *   ├── phases/
 *   │   ├── 01-foundation/
 *   │   │   ├── 01-01-PLAN.md
 *   │   │   ├── 01-01-SUMMARY.md
 *   │   │   └── 01-CONTEXT.md
 *   │   └── 02-api-endpoints/
 *   │       └── ...
 *   ├── PROJECT.md
 *   ├── ROADMAP.md
 *   ├── STATE.md
 *   └── ISSUES.md
 *
 * @module goodflows/lib/phase-manager
 */

import { promises as fs } from 'fs';
import path from 'path';

/**
 * Phase status values
 */
export const PHASE_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETE: 'complete',
};

/**
 * Plan status values
 */
export const PLAN_STATUS = {
  NOT_PLANNED: 'not_planned',
  READY_TO_EXECUTE: 'ready_to_execute',
  IN_PROGRESS: 'in_progress',
  COMPLETE: 'complete',
  FAILED: 'failed',
};

/**
 * Task types for PLAN.md
 */
export const TASK_TYPES = {
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
 * Deviation rules
 */
export const DEVIATION_RULES = {
  BUG_FOUND: 1,           // Auto-fix, document
  CRITICAL_MISSING: 2,    // Auto-add (security, correctness)
  BLOCKER: 3,             // Auto-fix (can't proceed otherwise)
  ARCHITECTURAL: 4,       // STOP, ask user
  ENHANCEMENT: 5,         // Log to ISSUES.md, continue
};

/**
 * PhaseManager - Manages phases and plans according to GSD spec
 */
export class PhaseManager {
  /**
   * Create a new PhaseManager
   * @param {object} options - Configuration options
   * @param {string} options.basePath - Base path for .goodflows directory
   */
  constructor(options = {}) {
    this.basePath = options.basePath || process.cwd();
    this.goodflowsPath = path.join(this.basePath, '.goodflows');
    this.phasesPath = path.join(this.goodflowsPath, 'phases');
  }

  /**
   * Initialize the phases directory structure
   * @returns {Promise<object>} Initialization result
   */
  async init() {
    await fs.mkdir(this.phasesPath, { recursive: true });
    return {
      success: true,
      path: this.phasesPath,
    };
  }

  /**
   * Create a new phase
   * @param {object} phaseData - Phase data
   * @param {string} phaseData.name - Phase name (kebab-case)
   * @param {string} phaseData.goal - What this phase achieves
   * @param {number} phaseData.position - Position in sequence (optional)
   * @param {string[]} phaseData.dependsOn - Phase names this depends on
   * @returns {Promise<object>} Created phase info
   */
  async createPhase(phaseData) {
    const { name, goal, position, dependsOn = [] } = phaseData;

    // Validate name (kebab-case)
    const kebabName = this._toKebabCase(name);

    // Get existing phases to determine number
    const existingPhases = await this.listPhases();
    const phaseNumber = position || existingPhases.length + 1;
    const paddedNumber = String(phaseNumber).padStart(2, '0');
    const phaseDirName = `${paddedNumber}-${kebabName}`;
    const phasePath = path.join(this.phasesPath, phaseDirName);

    // Create phase directory
    await fs.mkdir(phasePath, { recursive: true });

    // Create phase context file
    const contextContent = this._generatePhaseContext({
      number: phaseNumber,
      name: kebabName,
      goal,
      dependsOn,
    });
    await fs.writeFile(
      path.join(phasePath, `${paddedNumber}-CONTEXT.md`),
      contextContent,
      'utf-8',
    );

    return {
      success: true,
      phaseNumber,
      phaseName: phaseDirName,
      path: phasePath,
      message: `Phase ${phaseNumber} '${kebabName}' created`,
    };
  }

  /**
   * List all phases
   * @returns {Promise<object[]>} Array of phase info
   */
  async listPhases() {
    try {
      const entries = await fs.readdir(this.phasesPath, { withFileTypes: true });
      const phases = [];

      for (const entry of entries) {
        if (entry.isDirectory() && /^\d{2}-/.test(entry.name)) {
          const [number, ...nameParts] = entry.name.split('-');
          const phasePath = path.join(this.phasesPath, entry.name);
          const plans = await this._listPlansInPhase(phasePath, number);

          phases.push({
            number: parseInt(number, 10),
            name: nameParts.join('-'),
            dirName: entry.name,
            path: phasePath,
            plans,
            status: this._determinePhaseStatus(plans),
          });
        }
      }

      return phases.sort((a, b) => a.number - b.number);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get phase by number or name
   * @param {number|string} identifier - Phase number or name
   * @returns {Promise<object|null>} Phase info or null
   */
  async getPhase(identifier) {
    const phases = await this.listPhases();

    if (typeof identifier === 'number') {
      return phases.find(p => p.number === identifier) || null;
    }

    const normalizedName = this._toKebabCase(identifier);
    return phases.find(p => p.name === normalizedName) || null;
  }

  /**
   * Create a plan for a phase
   * @param {object} planData - Plan data
   * @param {number|string} planData.phase - Phase number or name
   * @param {object[]} planData.tasks - Array of task definitions
   * @param {string} planData.objective - Plan objective
   * @returns {Promise<object>} Created plan info
   */
  async createPlan(planData) {
    const { phase, tasks, objective } = planData;

    const phaseInfo = await this.getPhase(phase);
    if (!phaseInfo) {
      throw new Error(`Phase not found: ${phase}`);
    }

    const paddedPhase = String(phaseInfo.number).padStart(2, '0');

    // Get next plan number for this phase
    const existingPlans = await this._listPlansInPhase(phaseInfo.path, paddedPhase);
    const planNumber = existingPlans.length + 1;
    const paddedPlan = String(planNumber).padStart(2, '0');

    // Generate PLAN.md content
    const planContent = this._generatePlanContent({
      phase: paddedPhase,
      phaseName: phaseInfo.name,
      plan: paddedPlan,
      tasks,
      objective,
    });

    const planFileName = `${paddedPhase}-${paddedPlan}-PLAN.md`;
    const planPath = path.join(phaseInfo.path, planFileName);

    await fs.writeFile(planPath, planContent, 'utf-8');

    return {
      success: true,
      planNumber,
      path: planPath,
      taskCount: tasks.length,
      tasks: tasks.map((t, i) => t.name || `Task ${i + 1}`),
    };
  }

  /**
   * Get a specific plan
   * @param {number|string} phase - Phase number or name
   * @param {number} planNumber - Plan number
   * @returns {Promise<object|null>} Plan info or null
   */
  async getPlan(phase, planNumber) {
    const phaseInfo = await this.getPhase(phase);
    if (!phaseInfo) {
      return null;
    }

    const paddedPhase = String(phaseInfo.number).padStart(2, '0');
    const paddedPlan = String(planNumber).padStart(2, '0');
    const planFileName = `${paddedPhase}-${paddedPlan}-PLAN.md`;
    const planPath = path.join(phaseInfo.path, planFileName);

    try {
      const content = await fs.readFile(planPath, 'utf-8');
      return {
        phase: phaseInfo.number,
        phaseName: phaseInfo.name,
        planNumber,
        path: planPath,
        content,
        parsed: this._parsePlanContent(content),
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a summary for a completed plan
   * @param {object} summaryData - Summary data
   * @param {number|string} summaryData.phase - Phase number or name
   * @param {number} summaryData.planNumber - Plan number
   * @param {object[]} summaryData.taskCommits - Array of task commit info
   * @param {object} summaryData.metrics - Performance metrics
   * @returns {Promise<object>} Created summary info
   */
  async createSummary(summaryData) {
    const { phase, planNumber, taskCommits, metrics, accomplishments, deviations } = summaryData;

    const phaseInfo = await this.getPhase(phase);
    if (!phaseInfo) {
      throw new Error(`Phase not found: ${phase}`);
    }

    const paddedPhase = String(phaseInfo.number).padStart(2, '0');
    const paddedPlan = String(planNumber).padStart(2, '0');

    const summaryContent = this._generateSummaryContent({
      phase: paddedPhase,
      phaseName: phaseInfo.name,
      plan: paddedPlan,
      taskCommits,
      metrics,
      accomplishments,
      deviations,
    });

    const summaryFileName = `${paddedPhase}-${paddedPlan}-SUMMARY.md`;
    const summaryPath = path.join(phaseInfo.path, summaryFileName);

    await fs.writeFile(summaryPath, summaryContent, 'utf-8');

    return {
      success: true,
      path: summaryPath,
    };
  }

  /**
   * Get the current phase (first non-complete phase)
   * @returns {Promise<object|null>} Current phase info
   */
  async getCurrentPhase() {
    const phases = await this.listPhases();
    return phases.find(p => p.status !== PHASE_STATUS.COMPLETE) || null;
  }

  /**
   * Get the next plan to execute
   * @returns {Promise<object|null>} Next plan info
   */
  async getNextPlan() {
    const currentPhase = await this.getCurrentPhase();
    if (!currentPhase) {
      return null;
    }

    const pendingPlan = currentPhase.plans.find(
      p => p.status === PLAN_STATUS.READY_TO_EXECUTE,
    );
    if (pendingPlan) {
      return this.getPlan(currentPhase.number, pendingPlan.number);
    }

    return null;
  }

  /**
   * Mark a phase as complete
   * @param {number|string} phase - Phase number or name
   * @param {string} summary - One-liner summary of what shipped
   * @returns {Promise<object>} Completion result
   */
  async completePhase(phase, summary) {
    const phaseInfo = await this.getPhase(phase);
    if (!phaseInfo) {
      throw new Error(`Phase not found: ${phase}`);
    }

    // Verify all plans are complete
    const incompletePlans = phaseInfo.plans.filter(
      p => p.status !== PLAN_STATUS.COMPLETE,
    );
    if (incompletePlans.length > 0) {
      return {
        success: false,
        error: `${incompletePlans.length} plan(s) not complete`,
        incompletePlans: incompletePlans.map(p => p.number),
      };
    }

    // Calculate totals
    const totalDuration = phaseInfo.plans.reduce((sum, p) => {
      return sum + (p.duration || 0);
    }, 0);

    return {
      success: true,
      phase: phaseInfo.number,
      summary,
      plansExecuted: phaseInfo.plans.length,
      totalDuration: `${Math.round(totalDuration)}min`,
      roadmapUpdated: true,
      stateUpdated: true,
    };
  }

  /**
   * Get phase status overview
   * @param {number|string} phase - Phase number or name (optional, defaults to current)
   * @returns {Promise<object>} Phase status
   */
  async getPhaseStatus(phase) {
    const phaseInfo = phase
      ? await this.getPhase(phase)
      : await this.getCurrentPhase();

    if (!phaseInfo) {
      return { error: 'Phase not found' };
    }

    const completedPlans = phaseInfo.plans.filter(
      p => p.status === PLAN_STATUS.COMPLETE,
    );
    const pendingPlans = phaseInfo.plans.filter(
      p => p.status === PLAN_STATUS.READY_TO_EXECUTE,
    );
    const inProgressPlans = phaseInfo.plans.filter(
      p => p.status === PLAN_STATUS.IN_PROGRESS,
    );

    const tasksCompleted = completedPlans.reduce((sum, p) => sum + (p.taskCount || 0), 0);
    const tasksRemaining = pendingPlans.reduce((sum, p) => sum + (p.taskCount || 0), 0);

    const progress = phaseInfo.plans.length > 0
      ? Math.round((completedPlans.length / phaseInfo.plans.length) * 100)
      : 0;

    return {
      phase: phaseInfo.number,
      name: phaseInfo.name,
      status: phaseInfo.status,
      plans: {
        total: phaseInfo.plans.length,
        completed: completedPlans.length,
        current: inProgressPlans.length > 0 ? inProgressPlans[0].number : pendingPlans[0]?.number,
        pending: pendingPlans.length,
      },
      currentPlan: inProgressPlans[0] || pendingPlans[0] || null,
      tasksCompleted,
      tasksRemaining,
      progress,
      nextStep: this._determineNextStep(phaseInfo),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Private Helper Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Convert string to kebab-case
   */
  _toKebabCase(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * List plans in a phase directory
   */
  async _listPlansInPhase(phasePath, phaseNumber) {
    try {
      const files = await fs.readdir(phasePath);
      const planFiles = files.filter(f =>
        f.startsWith(`${phaseNumber}-`) && f.endsWith('-PLAN.md'),
      );

      const plans = [];
      for (const file of planFiles) {
        const match = file.match(/^\d{2}-(\d{2})-PLAN\.md$/);
        if (match) {
          const planNumber = parseInt(match[1], 10);
          const summaryFile = file.replace('-PLAN.md', '-SUMMARY.md');
          const hasSummary = files.includes(summaryFile);

          plans.push({
            number: planNumber,
            fileName: file,
            path: path.join(phasePath, file),
            status: hasSummary ? PLAN_STATUS.COMPLETE : PLAN_STATUS.READY_TO_EXECUTE,
          });
        }
      }

      return plans.sort((a, b) => a.number - b.number);
    } catch (error) {
      return [];
    }
  }

  /**
   * Determine phase status from its plans
   */
  _determinePhaseStatus(plans) {
    if (plans.length === 0) {
      return PHASE_STATUS.PENDING;
    }

    const allComplete = plans.every(p => p.status === PLAN_STATUS.COMPLETE);
    if (allComplete) {
      return PHASE_STATUS.COMPLETE;
    }

    const anyStarted = plans.some(
      p => p.status === PLAN_STATUS.COMPLETE || p.status === PLAN_STATUS.IN_PROGRESS,
    );
    if (anyStarted) {
      return PHASE_STATUS.IN_PROGRESS;
    }

    return PHASE_STATUS.PENDING;
  }

  /**
   * Determine next step for a phase
   */
  _determineNextStep(phaseInfo) {
    if (phaseInfo.status === PHASE_STATUS.COMPLETE) {
      return 'Phase complete. Start next phase.';
    }

    if (phaseInfo.plans.length === 0) {
      return `Plan phase with goodflows_phase_plan({ phase: ${phaseInfo.number} })`;
    }

    const pendingPlan = phaseInfo.plans.find(
      p => p.status === PLAN_STATUS.READY_TO_EXECUTE,
    );
    if (pendingPlan) {
      return `Execute plan ${phaseInfo.number}-${String(pendingPlan.number).padStart(2, '0')} with goodflows_execute_plan`;
    }

    return 'Complete current plan';
  }

  /**
   * Generate phase context file content
   */
  _generatePhaseContext({ number, name, goal, dependsOn }) {
    return `# Phase ${number}: ${name}

## Goal
${goal}

## Dependencies
${dependsOn.length > 0 ? dependsOn.map(d => `- ${d}`).join('\n') : '- None'}

## Discussion Notes
*Use this space to capture important decisions and context during phase planning.*

## Key Decisions
| Decision | Rationale | Date |
|----------|-----------|------|

## Technical Notes
*Important implementation details, patterns to follow, etc.*

---
*Created: ${new Date().toISOString()}*
`;
  }

  /**
   * Generate PLAN.md content with multi-task support
   */
  _generatePlanContent({ phase, phaseName, plan, tasks, objective }) {
    const taskXml = tasks.map((task, index) => {
      const taskId = task.id || `task-${index + 1}`;
      const taskType = task.type || TASK_TYPES.AUTO;

      if (taskType.startsWith('checkpoint:')) {
        return this._generateCheckpointTask(task, taskId, taskType);
      }

      return `<task type="${taskType}" id="${taskId}">
  <name>${task.name || `Task ${index + 1}`}</name>
  <files>${Array.isArray(task.files) ? task.files.join(', ') : (task.files || '')}</files>
  <action>
    ${task.action || '[Implementation instructions]'}
  </action>
  <verify>${task.verify || '[Verification command or check]'}</verify>
  <done>${task.done || '[Acceptance criteria]'}</done>
</task>`;
    }).join('\n\n');

    return `---
phase: ${phase}-${phaseName}
plan: ${plan}
type: execute
depends_on: []
files_modified: []
---

<objective>
${objective?.description || '[What this plan accomplishes]'}

Purpose: ${objective?.purpose || '[Why this matters]'}
Output: ${objective?.output || '[What artifacts will be created]'}
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

${taskXml}

</tasks>

<verification>
Before declaring complete:
${tasks.map((t, i) => `- [ ] Task ${i + 1} verification passed`).join('\n')}
</verification>

<success_criteria>
- All tasks completed
- All verification checks pass
</success_criteria>
`;
  }

  /**
   * Generate checkpoint task XML
   */
  _generateCheckpointTask(task, taskId, taskType) {
    const gate = task.gate || GATE_VALUES.BLOCKING;

    return `<task type="${taskType}" id="${taskId}" gate="${gate}">
  <what-built>${task.whatBuilt || '[What was just built]'}</what-built>
  <how-to-verify>
    ${task.howToVerify || '1. [Verification steps]'}
  </how-to-verify>
  <resume-signal>${task.resumeSignal || 'Type "approved" to continue'}</resume-signal>
</task>`;
  }

  /**
   * Generate SUMMARY.md content
   */
  _generateSummaryContent({ phase, phaseName, plan, taskCommits, metrics, accomplishments, deviations }) {
    const now = new Date().toISOString();
    const taskCommitsSection = taskCommits && taskCommits.length > 0
      ? taskCommits.map((tc, i) =>
        `${i + 1}. **${tc.name}** - \`${tc.hash}\` (${tc.type})`,
      ).join('\n')
      : '*No commits recorded*';

    const deviationsSection = deviations && deviations.length > 0
      ? deviations.map((d, i) => `### ${d.type === 'auto-fix' ? 'Auto-fixed Issues' : 'Deferred Enhancements'}
**${i + 1}. [Rule ${d.rule || 'N/A'} - ${d.category || 'General'}] ${d.description}**
- **Found during**: Task ${d.task || 'N/A'}
- **Issue**: ${d.issue || 'N/A'}
- **Fix**: ${d.fix || 'N/A'}
- **Verification**: ${d.verification || 'N/A'}
- **Committed in**: ${d.commitHash || 'N/A'}`).join('\n\n')
      : '*None*';

    return `---
phase: ${phase}-${phaseName}
plan: ${plan}
subsystem: ${metrics?.subsystem || 'core'}
tags: ${JSON.stringify(metrics?.tags || [])}

requires:
  - phase: ${metrics?.requires?.phase || 'none'}
    provides: ${metrics?.requires?.provides || 'none'}
provides:
  - ${metrics?.provides || 'completed plan'}
affects: ${JSON.stringify(metrics?.affects || [])}

tech-stack:
  added: ${JSON.stringify(metrics?.techStack?.added || [])}
  patterns: ${JSON.stringify(metrics?.techStack?.patterns || [])}

key-files:
  created: ${JSON.stringify(metrics?.keyFiles?.created || [])}
  modified: ${JSON.stringify(metrics?.keyFiles?.modified || [])}

key-decisions: ${JSON.stringify(metrics?.keyDecisions || [])}

patterns-established: ${JSON.stringify(metrics?.patternsEstablished || [])}

issues-created: ${JSON.stringify(metrics?.issuesCreated || [])}

duration: ${metrics?.duration || '0min'}
completed: ${now.split('T')[0]}
---

# Phase ${phase} Plan ${plan}: ${phaseName} Summary

**${metrics?.oneLiner || 'Plan completed successfully'}**

## Performance
- **Duration**: ${metrics?.duration || 'N/A'}
- **Started**: ${metrics?.startedAt || 'N/A'}
- **Completed**: ${now}
- **Tasks**: ${taskCommits?.length || 0}
- **Files modified**: ${metrics?.filesModified || 0}

## Accomplishments
${accomplishments && accomplishments.length > 0
  ? accomplishments.map(a => `- ${a}`).join('\n')
  : '- Plan completed'}

## Task Commits
Each task committed atomically:

${taskCommitsSection}

${metrics?.metadataCommit ? `**Plan metadata**: \`${metrics.metadataCommit}\` (docs: complete plan)` : ''}

## Files Created/Modified
${metrics?.keyFiles?.created?.length || metrics?.keyFiles?.modified?.length
  ? [
    ...(metrics?.keyFiles?.created || []).map(f => `- \`${f}\` (created)`),
    ...(metrics?.keyFiles?.modified || []).map(f => `- \`${f}\` (modified)`),
  ].join('\n')
  : '*None recorded*'}

## Decisions Made
${metrics?.keyDecisions?.length > 0
  ? metrics.keyDecisions.map(d => `- ${d}`).join('\n')
  : '*None*'}

## Deviations from Plan

${deviationsSection}

## Issues Encountered
${metrics?.issues?.length > 0
  ? metrics.issues.map(i => `- ${i}`).join('\n')
  : '*None*'}

## Next Phase Readiness
${metrics?.nextPhaseReadiness || '[What\'s ready, blockers, concerns]'}

---
*Completed: ${now}*
`;
  }

  /**
   * Parse PLAN.md content to extract metadata and tasks
   */
  _parsePlanContent(content) {
    const result = {
      metadata: {},
      objective: null,
      tasks: [],
      verification: [],
      successCriteria: [],
      hasCheckpoints: false,
      checkpointTypes: [],
    };

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const lines = frontmatterMatch[1].split('\n');
      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          const value = valueParts.join(':').trim();
          result.metadata[key.trim()] = value;
        }
      }
    }

    // Parse objective
    const objectiveMatch = content.match(/<objective>([\s\S]*?)<\/objective>/);
    if (objectiveMatch) {
      result.objective = objectiveMatch[1].trim();
    }

    // Parse tasks
    const taskRegex = /<task[^>]*type=["']([^"']+)["'][^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/task>/gi;
    let taskMatch;
    while ((taskMatch = taskRegex.exec(content)) !== null) {
      const taskType = taskMatch[1];
      const taskId = taskMatch[2];
      const taskContent = taskMatch[3];

      const task = {
        id: taskId,
        type: taskType,
      };

      // Parse task fields based on type
      if (taskType.startsWith('checkpoint:')) {
        result.hasCheckpoints = true;
        if (!result.checkpointTypes.includes(taskType)) {
          result.checkpointTypes.push(taskType);
        }
        task.whatBuilt = this._extractElement(taskContent, 'what-built');
        task.howToVerify = this._extractElement(taskContent, 'how-to-verify');
        task.resumeSignal = this._extractElement(taskContent, 'resume-signal');
      } else {
        task.name = this._extractElement(taskContent, 'name');
        task.files = this._extractElement(taskContent, 'files');
        task.action = this._extractElement(taskContent, 'action');
        task.verify = this._extractElement(taskContent, 'verify');
        task.done = this._extractElement(taskContent, 'done');
      }

      result.tasks.push(task);
    }

    // Parse verification
    const verificationMatch = content.match(/<verification>([\s\S]*?)<\/verification>/);
    if (verificationMatch) {
      const checks = verificationMatch[1].match(/- \[[ x]\] .+/g) || [];
      result.verification = checks.map(c => c.replace(/- \[[ x]\] /, '').trim());
    }

    // Parse success criteria
    const criteriaMatch = content.match(/<success_criteria>([\s\S]*?)<\/success_criteria>/);
    if (criteriaMatch) {
      const criteria = criteriaMatch[1].match(/- .+/g) || [];
      result.successCriteria = criteria.map(c => c.replace(/^- /, '').trim());
    }

    // Determine execution strategy
    result.executionStrategy = result.hasCheckpoints ? 'segmented' : 'autonomous';

    return result;
  }

  /**
   * Extract element content from XML
   */
  _extractElement(content, tagName) {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : null;
  }

  // ─────────────────────────────────────────────────────────────
  // Deviation Handling Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Classify a deviation based on its characteristics
   * @param {object} deviation - Deviation info
   * @param {string} deviation.description - What happened
   * @param {string} deviation.type - Type of deviation (bug, security, blocker, etc.)
   * @param {string} deviation.file - File affected
   * @param {boolean} deviation.blocksProgress - Whether it prevents continuing
   * @returns {object} Classification with rule and recommended action
   */
  classifyDeviation(deviation) {
    const { description = '', type = '', blocksProgress = false } = deviation;
    const descLower = description.toLowerCase();
    const typeLower = type.toLowerCase();

    // Rule 1: Bug Found - existing bug discovered during implementation
    if (typeLower === 'bug' || descLower.includes('bug') || descLower.includes('broken')) {
      return {
        rule: DEVIATION_RULES.BUG_FOUND,
        category: 'bug_found',
        action: 'auto_fix',
        description: 'Auto-fix the bug and document in summary',
        requiresUserInput: false,
      };
    }

    // Rule 2: Critical Missing - security or correctness gap
    if (
      typeLower === 'security' ||
      typeLower === 'critical' ||
      descLower.includes('security') ||
      descLower.includes('vulnerability') ||
      descLower.includes('injection') ||
      descLower.includes('sanitiz') ||
      descLower.includes('validat') ||
      descLower.includes('missing critical')
    ) {
      return {
        rule: DEVIATION_RULES.CRITICAL_MISSING,
        category: 'missing_critical',
        action: 'auto_add',
        description: 'Auto-add the missing security/correctness feature',
        requiresUserInput: false,
      };
    }

    // Rule 3: Blocker - can't proceed without fixing
    if (blocksProgress || descLower.includes('blocker') || descLower.includes('cannot proceed')) {
      return {
        rule: DEVIATION_RULES.BLOCKER,
        category: 'blocker',
        action: 'auto_fix',
        description: 'Auto-fix the blocker to allow progress',
        requiresUserInput: false,
      };
    }

    // Rule 4: Architectural - design change needed
    if (
      typeLower === 'architectural' ||
      typeLower === 'design' ||
      descLower.includes('architect') ||
      descLower.includes('redesign') ||
      descLower.includes('restructure') ||
      descLower.includes('major change')
    ) {
      return {
        rule: DEVIATION_RULES.ARCHITECTURAL,
        category: 'architectural',
        action: 'stop_ask_user',
        description: 'STOP and ask user for decision on architectural change',
        requiresUserInput: true,
      };
    }

    // Rule 5: Enhancement - nice to have improvement
    return {
      rule: DEVIATION_RULES.ENHANCEMENT,
      category: 'enhancement',
      action: 'defer',
      description: 'Log to ISSUES.md and continue with original task',
      requiresUserInput: false,
    };
  }

  /**
   * Handle a deviation according to its classification
   * @param {object} deviation - Deviation info
   * @param {object} context - Execution context
   * @param {string} context.taskId - Current task ID
   * @param {string} context.phase - Phase identifier
   * @param {string} context.plan - Plan identifier
   * @returns {Promise<object>} Handling result
   */
  async handleDeviation(deviation, context = {}) {
    const classification = this.classifyDeviation(deviation);
    const { taskId, phase, plan } = context;

    const result = {
      deviation,
      classification,
      handled: false,
      action: null,
      requiresUserInput: classification.requiresUserInput,
    };

    switch (classification.rule) {
      case DEVIATION_RULES.BUG_FOUND:
      case DEVIATION_RULES.CRITICAL_MISSING:
      case DEVIATION_RULES.BLOCKER:
        // Rules 1-3: Auto-fix and document
        result.action = 'auto_fix';
        result.handled = true;
        result.instructions = [
          `Fix the issue: ${deviation.description}`,
          'Include the fix in the current task commit',
          'Document the deviation in the summary',
        ];
        result.summaryEntry = {
          type: 'auto-fix',
          rule: classification.rule,
          category: classification.category,
          description: deviation.description,
          task: taskId,
          issue: deviation.issue || 'N/A',
          fix: deviation.proposedFix || 'Applied fix during task execution',
          verification: deviation.verification || 'Verified by task completion',
          commitHash: null, // To be filled after commit
        };
        break;

      case DEVIATION_RULES.ARCHITECTURAL:
        // Rule 4: STOP and ask user
        result.action = 'stop_ask_user';
        result.handled = false;
        result.requiresUserInput = true;
        result.userPrompt = {
          title: 'Architectural Decision Required',
          description: deviation.description,
          options: [
            {
              id: 'proceed',
              label: 'Proceed with suggested change',
              description: 'Apply the architectural modification',
            },
            {
              id: 'modify',
              label: 'Modify approach',
              description: 'Discuss alternative approaches',
            },
            {
              id: 'abort',
              label: 'Abort plan',
              description: 'Stop execution and return to planning',
            },
          ],
        };
        break;

      case DEVIATION_RULES.ENHANCEMENT:
        // Rule 5: Defer to ISSUES.md
        result.action = 'defer';
        result.handled = true;
        result.instructions = [
          'Continue with the original task',
          'Log enhancement to ISSUES.md',
        ];
        result.issueEntry = {
          title: deviation.title || `Enhancement: ${deviation.description.slice(0, 50)}`,
          phase: phase,
          task: taskId,
          type: 'enhancement',
          effort: deviation.effort || 'M',
          priority: 'low',
          description: deviation.description,
          proposedFix: deviation.proposedFix,
        };
        break;
    }

    return result;
  }

  /**
   * Generate an issue entry for ISSUES.md
   * @param {object} issueData - Issue data
   * @returns {string} Markdown formatted issue entry
   */
  generateIssueEntry(issueData) {
    const issueNumber = issueData.number || 'XXX';
    return `### ISS-${issueNumber}: ${issueData.title}
- **Phase**: ${issueData.phase || 'N/A'} (Task ${issueData.task || 'N/A'})
- **Type**: ${issueData.type || 'enhancement'}
- **Effort**: ${issueData.effort || 'M'}
- **Priority**: ${issueData.priority || 'medium'}
- **Description**: ${issueData.description}
${issueData.proposedFix ? `- **Proposed fix**: ${issueData.proposedFix}` : ''}
`;
  }

  /**
   * Get deviation handling rules documentation
   * @returns {object} Rules documentation
   */
  getDeviationRules() {
    return {
      rules: [
        {
          number: 1,
          name: 'Bug Found',
          trigger: 'Existing bug discovered during implementation',
          action: 'Auto-fix and document in summary',
          requiresUserInput: false,
        },
        {
          number: 2,
          name: 'Critical Missing',
          trigger: 'Security or correctness gap identified',
          action: 'Auto-add the missing feature',
          requiresUserInput: false,
        },
        {
          number: 3,
          name: 'Blocker',
          trigger: 'Cannot proceed without fix',
          action: 'Auto-fix to allow progress',
          requiresUserInput: false,
        },
        {
          number: 4,
          name: 'Architectural',
          trigger: 'Design change needed',
          action: 'STOP and ask user for decision',
          requiresUserInput: true,
        },
        {
          number: 5,
          name: 'Enhancement',
          trigger: 'Nice-to-have improvement',
          action: 'Log to ISSUES.md and continue',
          requiresUserInput: false,
        },
      ],
      summary: 'Rules 1-3 are auto-handled, Rule 4 requires user input, Rule 5 defers work',
    };
  }
}

/**
 * Create a new PhaseManager instance
 * @param {object} options - Configuration options
 * @returns {PhaseManager} Manager instance
 */
export function createPhaseManager(options = {}) {
  return new PhaseManager(options);
}

export default {
  PhaseManager,
  createPhaseManager,
  PHASE_STATUS,
  PLAN_STATUS,
  TASK_TYPES,
  GATE_VALUES,
  DEVIATION_RULES,
};
