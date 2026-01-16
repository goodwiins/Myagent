/**
 * GoodFlows MCP Tool Registry
 *
 * Manages tool definitions and handlers using a registry pattern.
 * Replaces the 65-case switch statement with a maintainable handler map.
 *
 * @module goodflows/bin/mcp/tool-registry
 */

/**
 * Tool Registry - manages MCP tools and their handlers
 *
 * Usage:
 * ```javascript
 * const registry = new ToolRegistry();
 *
 * // Register tools with their handlers
 * registry.register(contextTools, contextHandlers);
 * registry.register(sessionTools, sessionHandlers);
 *
 * // Handle tool calls
 * const result = await registry.handle('goodflows_context_query', args, services);
 * ```
 */
export class ToolRegistry {
  constructor() {
    /** @type {Map<string, object>} Tool definitions by name */
    this.tools = new Map();

    /** @type {Map<string, Function>} Handler functions by tool name */
    this.handlers = new Map();

    /** @type {Map<string, string>} Tool categories by name */
    this.categories = new Map();
  }

  /**
   * Register a single tool with its handler
   *
   * @param {object} tool - Tool definition with name, description, inputSchema
   * @param {Function} handler - Handler function (args, services) => result
   * @param {string} category - Category name for organization
   */
  registerTool(tool, handler, category = 'misc') {
    if (!tool.name) {
      throw new Error('Tool must have a name');
    }
    if (typeof handler !== 'function') {
      throw new Error(`Handler for ${tool.name} must be a function`);
    }

    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
    this.categories.set(tool.name, category);
  }

  /**
   * Register multiple tools from a handler module
   *
   * @param {object} module - Handler module with tools[] and handlers{}
   * @param {string} category - Category name
   */
  registerModule(module, category) {
    const { tools, handlers } = module;

    if (!Array.isArray(tools)) {
      throw new Error('Module must export a tools array');
    }
    if (!handlers || typeof handlers !== 'object') {
      throw new Error('Module must export a handlers object');
    }

    for (const tool of tools) {
      const handler = handlers[tool.name];
      if (!handler) {
        console.warn(`Warning: No handler found for tool ${tool.name}`);
        continue;
      }
      this.registerTool(tool, handler, category);
    }
  }

  /**
   * Handle a tool call
   *
   * @param {string} name - Tool name
   * @param {object} args - Tool arguments
   * @param {object} services - Service container
   * @returns {Promise<object>} Tool result
   */
  async handle(name, args, services) {
    const handler = this.handlers.get(name);

    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return handler(args, services);
  }

  /**
   * Check if a tool exists
   *
   * @param {string} name - Tool name
   * @returns {boolean}
   */
  has(name) {
    return this.handlers.has(name);
  }

  /**
   * Get a tool definition
   *
   * @param {string} name - Tool name
   * @returns {object|undefined}
   */
  getTool(name) {
    return this.tools.get(name);
  }

  /**
   * Get all tool definitions
   *
   * @returns {object[]}
   */
  getAllTools() {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   *
   * @param {string} category - Category name
   * @returns {object[]}
   */
  getToolsByCategory(category) {
    const result = [];
    for (const [name, cat] of this.categories) {
      if (cat === category) {
        result.push(this.tools.get(name));
      }
    }
    return result;
  }

  /**
   * Get all category names
   *
   * @returns {string[]}
   */
  getCategories() {
    return [...new Set(this.categories.values())];
  }

  /**
   * Get tool count
   *
   * @returns {number}
   */
  get size() {
    return this.tools.size;
  }

  /**
   * Get registry stats
   *
   * @returns {object}
   */
  getStats() {
    const categoryStats = {};
    for (const category of this.getCategories()) {
      categoryStats[category] = this.getToolsByCategory(category).length;
    }

    return {
      totalTools: this.size,
      categories: this.getCategories(),
      toolsPerCategory: categoryStats,
    };
  }
}

/**
 * Create a new tool registry
 *
 * @returns {ToolRegistry}
 */
export function createToolRegistry() {
  return new ToolRegistry();
}

/**
 * Helper to create a standard MCP response
 *
 * @param {any} data - Response data
 * @returns {object} MCP-formatted response
 */
export function mcpResponse(data) {
  return {
    content: [{
      type: 'text',
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    }],
  };
}

/**
 * Helper to create an error response
 *
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @returns {object} MCP-formatted error response
 */
export function mcpError(message, code = 'ERROR') {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ error: message, code }, null, 2),
    }],
    isError: true,
  };
}

export default {
  ToolRegistry,
  createToolRegistry,
  mcpResponse,
  mcpError,
};
