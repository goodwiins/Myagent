/**
 * GoodFlows MCP Handlers Index
 *
 * Exports all handler modules for easy registration with the tool registry.
 *
 * @module goodflows/bin/mcp/handlers
 */

export { default as context } from './context.js';
export { default as session } from './session.js';
export { default as pattern } from './pattern.js';
export { default as queue } from './queue.js';
export { default as tracking } from './tracking.js';
export { default as phase } from './phase.js';
export { default as plan } from './plan.js';
export { default as gsd } from './gsd.js';
export { default as misc } from './misc.js';
export { default as sync } from './sync.js';

/**
 * Get all handler modules as an array for registration
 *
 * @returns {Promise<Array<{module: object, category: string}>>}
 */
export async function getAllHandlerModules() {
  const context = await import('./context.js');
  const session = await import('./session.js');
  const pattern = await import('./pattern.js');
  const queue = await import('./queue.js');
  const tracking = await import('./tracking.js');
  const phase = await import('./phase.js');
  const plan = await import('./plan.js');
  const gsd = await import('./gsd.js');
  const misc = await import('./misc.js');
  const sync = await import('./sync.js');

  return [
    { module: context.default, category: 'context' },
    { module: session.default, category: 'session' },
    { module: pattern.default, category: 'pattern' },
    { module: queue.default, category: 'queue' },
    { module: tracking.default, category: 'tracking' },
    { module: phase.default, category: 'phase' },
    { module: plan.default, category: 'plan' },
    { module: gsd.default, category: 'gsd' },
    { module: misc.default, category: 'misc' },
    { module: sync.default, category: 'sync' },
  ];
}

/**
 * Register all handlers with a tool registry
 *
 * @param {import('../tool-registry.js').ToolRegistry} registry
 */
export async function registerAllHandlers(registry) {
  const context = await import('./context.js');
  const session = await import('./session.js');
  const pattern = await import('./pattern.js');
  const queue = await import('./queue.js');
  const tracking = await import('./tracking.js');
  const phase = await import('./phase.js');
  const plan = await import('./plan.js');
  const gsd = await import('./gsd.js');
  const misc = await import('./misc.js');
  const sync = await import('./sync.js');

  registry.registerModule(context.default, 'context');
  registry.registerModule(session.default, 'session');
  registry.registerModule(pattern.default, 'pattern');
  registry.registerModule(queue.default, 'queue');
  registry.registerModule(tracking.default, 'tracking');
  registry.registerModule(phase.default, 'phase');
  registry.registerModule(plan.default, 'plan');
  registry.registerModule(gsd.default, 'gsd');
  registry.registerModule(misc.default, 'misc');
  registry.registerModule(sync.default, 'sync');

  return registry;
}
