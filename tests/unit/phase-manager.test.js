/**
 * Tests for PhaseManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PhaseManager, PHASE_STATUS, PLAN_STATUS } from '../../lib/phase-manager.js';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

describe('PhaseManager', () => {
  let tempDir;
  let phaseManager;

  beforeEach(async () => {
    // Create a temp directory for tests
    tempDir = path.join(tmpdir(), `goodflows-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    phaseManager = new PhaseManager({ basePath: tempDir });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('init()', () => {
    it('should create phases directory', async () => {
      const result = await phaseManager.init();
      expect(result.success).toBe(true);
      
      // Verify the returned path matches expected structure
      const expectedPath = path.join(tempDir, '.goodflows', 'phases');
      expect(result.path).toBe(expectedPath);
      
      // Use fs.stat for more reliable existence check on Windows
      const stats = await fs.stat(result.path);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('createPhase()', () => {
    it('should create a phase directory with context file', async () => {
      await phaseManager.init();
      
      const result = await phaseManager.createPhase({
        name: 'foundation',
        goal: 'Set up the foundation',
      });

      expect(result.success).toBe(true);
      expect(result.phaseNumber).toBe(1);
      expect(result.phaseName).toBe('01-foundation');

      // Check directory was created
      const phasePath = path.join(tempDir, '.goodflows', 'phases', '01-foundation');
      const exists = await fs.access(phasePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Check context file was created
      const contextPath = path.join(phasePath, '01-CONTEXT.md');
      const contextExists = await fs.access(contextPath).then(() => true).catch(() => false);
      expect(contextExists).toBe(true);
    });

    it('should convert name to kebab-case', async () => {
      await phaseManager.init();
      
      const result = await phaseManager.createPhase({
        name: 'API Endpoints',
        goal: 'Create API endpoints',
      });

      expect(result.phaseName).toBe('01-api-endpoints');
    });

    it('should assign sequential phase numbers', async () => {
      await phaseManager.init();
      
      await phaseManager.createPhase({ name: 'first', goal: 'First phase' });
      const result = await phaseManager.createPhase({ name: 'second', goal: 'Second phase' });

      expect(result.phaseNumber).toBe(2);
      expect(result.phaseName).toBe('02-second');
    });
  });

  describe('listPhases()', () => {
    it('should return empty array when no phases exist', async () => {
      await phaseManager.init();
      const phases = await phaseManager.listPhases();
      expect(phases).toEqual([]);
    });

    it('should list all phases', async () => {
      await phaseManager.init();
      
      await phaseManager.createPhase({ name: 'foundation', goal: 'Goal 1' });
      await phaseManager.createPhase({ name: 'api', goal: 'Goal 2' });
      
      const phases = await phaseManager.listPhases();
      
      expect(phases.length).toBe(2);
      expect(phases[0].number).toBe(1);
      expect(phases[0].name).toBe('foundation');
      expect(phases[1].number).toBe(2);
      expect(phases[1].name).toBe('api');
    });
  });

  describe('getPhase()', () => {
    it('should get phase by number', async () => {
      await phaseManager.init();
      await phaseManager.createPhase({ name: 'foundation', goal: 'Goal' });
      
      const phase = await phaseManager.getPhase(1);
      
      expect(phase).not.toBeNull();
      expect(phase.number).toBe(1);
      expect(phase.name).toBe('foundation');
    });

    it('should get phase by name', async () => {
      await phaseManager.init();
      await phaseManager.createPhase({ name: 'foundation', goal: 'Goal' });
      
      const phase = await phaseManager.getPhase('foundation');
      
      expect(phase).not.toBeNull();
      expect(phase.number).toBe(1);
    });

    it('should return null for non-existent phase', async () => {
      await phaseManager.init();
      const phase = await phaseManager.getPhase(999);
      expect(phase).toBeNull();
    });
  });

  describe('createPlan()', () => {
    it('should create a plan file', async () => {
      await phaseManager.init();
      await phaseManager.createPhase({ name: 'foundation', goal: 'Goal' });
      
      const result = await phaseManager.createPlan({
        phase: 1,
        tasks: [
          {
            name: 'Create user model',
            action: 'Add User model with email and password',
            verify: 'npx prisma validate',
            done: 'User model exists',
          },
        ],
        objective: {
          description: 'Set up user model',
          purpose: 'Enable user management',
          output: 'User model file',
        },
      });

      expect(result.success).toBe(true);
      expect(result.planNumber).toBe(1);
      expect(result.taskCount).toBe(1);

      // Check plan file was created
      const planPath = path.join(tempDir, '.goodflows', 'phases', '01-foundation', '01-01-PLAN.md');
      const exists = await fs.access(planPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should assign sequential plan numbers', async () => {
      await phaseManager.init();
      await phaseManager.createPhase({ name: 'foundation', goal: 'Goal' });
      
      await phaseManager.createPlan({
        phase: 1,
        tasks: [{ name: 'Task 1', action: 'Do something', verify: 'Test', done: 'Done' }],
      });
      
      const result = await phaseManager.createPlan({
        phase: 1,
        tasks: [{ name: 'Task 2', action: 'Do something else', verify: 'Test', done: 'Done' }],
      });

      expect(result.planNumber).toBe(2);
    });
  });

  describe('getPlan()', () => {
    it('should get a plan with parsed content', async () => {
      await phaseManager.init();
      await phaseManager.createPhase({ name: 'foundation', goal: 'Goal' });
      await phaseManager.createPlan({
        phase: 1,
        tasks: [{ name: 'Test task', action: 'Do it', verify: 'npm test', done: 'Done' }],
      });
      
      const plan = await phaseManager.getPlan(1, 1);
      
      expect(plan).not.toBeNull();
      expect(plan.phase).toBe(1);
      expect(plan.planNumber).toBe(1);
      expect(plan.content).toBeDefined();
      expect(plan.parsed).toBeDefined();
      expect(plan.parsed.tasks.length).toBe(1);
    });

    it('should return null for non-existent plan', async () => {
      await phaseManager.init();
      await phaseManager.createPhase({ name: 'foundation', goal: 'Goal' });
      
      const plan = await phaseManager.getPlan(1, 999);
      expect(plan).toBeNull();
    });
  });

  describe('getPhaseStatus()', () => {
    it('should return phase status', async () => {
      await phaseManager.init();
      await phaseManager.createPhase({ name: 'foundation', goal: 'Goal' });
      await phaseManager.createPlan({
        phase: 1,
        tasks: [{ name: 'Task', action: 'Do', verify: 'Test', done: 'Done' }],
      });
      
      const status = await phaseManager.getPhaseStatus(1);
      
      expect(status.phase).toBe(1);
      expect(status.name).toBe('foundation');
      expect(status.plans.total).toBe(1);
      expect(status.plans.pending).toBe(1);
      expect(status.progress).toBe(0);
    });
  });
});
