/**
 * GoodFlows MCP Service Container
 *
 * Dependency injection container for MCP handlers.
 * Provides centralized access to all GoodFlows services.
 *
 * @module goodflows/bin/mcp/services/container
 */

/**
 * Service Container - holds initialized services for handlers
 *
 * Services available:
 * - contextStore: ContextStore instance
 * - patternTracker: PatternTracker instance
 * - contextFileManager: ContextFileManager instance
 * - phaseManager: PhaseManager instance
 * - planExecutor: PlanExecutor instance
 * - gsdExecutor: GsdExecutor instance
 * - activeSessions: Map of active sessions
 * - activeQueues: Map of active queues
 * - workingDirectory: Project working directory
 * - goodflowsBasePath: .goodflows directory path
 */
export class ServiceContainer {
  constructor() {
    this.services = new Map();
    this._initialized = false;
  }

  /**
   * Register a service
   *
   * @param {string} name - Service name
   * @param {any} service - Service instance
   */
  register(name, service) {
    this.services.set(name, service);
  }

  /**
   * Get a service
   *
   * @param {string} name - Service name
   * @returns {any} Service instance
   */
  get(name) {
    if (!this.services.has(name)) {
      throw new Error(`Service not found: ${name}`);
    }
    return this.services.get(name);
  }

  /**
   * Check if a service exists
   *
   * @param {string} name - Service name
   * @returns {boolean}
   */
  has(name) {
    return this.services.has(name);
  }

  /**
   * Get service or return default
   *
   * @param {string} name - Service name
   * @param {any} defaultValue - Default value if not found
   * @returns {any}
   */
  getOrDefault(name, defaultValue = null) {
    return this.services.has(name) ? this.services.get(name) : defaultValue;
  }

  /**
   * Initialize all services from config
   *
   * @param {object} config - Service configuration
   */
  initializeAll(config) {
    for (const [name, service] of Object.entries(config)) {
      this.register(name, service);
    }
    this._initialized = true;
  }

  /**
   * Check if container is initialized
   */
  get initialized() {
    return this._initialized;
  }

  /**
   * Get all service names
   *
   * @returns {string[]}
   */
  getServiceNames() {
    return Array.from(this.services.keys());
  }

  /**
   * Create a proxy object for easy access
   *
   * @returns {object} Proxy with service properties
   */
  toProxy() {
    const container = this;
    return new Proxy({}, {
      get(target, prop) {
        if (container.has(prop)) {
          return container.get(prop);
        }
        return undefined;
      },
      has(target, prop) {
        return container.has(prop);
      },
    });
  }
}

/**
 * Create and initialize a service container
 *
 * @param {object} services - Service instances
 * @returns {ServiceContainer}
 */
export function createServiceContainer(services = {}) {
  const container = new ServiceContainer();
  container.initializeAll(services);
  return container;
}

export default {
  ServiceContainer,
  createServiceContainer,
};
