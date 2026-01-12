# GoodFlows - Agent Development Guide

This guide is for AI coding agents operating in the GoodFlows repository.

## Build & Test Commands

### Installation
```bash
npm install              # Install dependencies
npm install -g .         # Global install
make install             # Install for Claude Code
make install-cursor      # Install for Cursor
```

### Testing
```bash
npm test                 # Run all tests
make test                # Run all tests (Makefile)
make test-orchestrator   # Test review-orchestrator agent
make test-issue-creator  # Test issue-creator agent
make test-auto-fixer     # Test auto-fixer agent

# Run single test (no formal test framework - manual verification)
node scripts/test.js     # Validates agent files and config
```

### Linting & Quality
```bash
npm run lint             # Lint all files (currently stub)
make lint                # Lint markdown files (requires markdownlint)
```

### Utilities
```bash
make check-deps          # Check for required dependencies
make clean               # Clean generated files
make version             # Show version and agents
```

## Code Style Guidelines

### File Organization
- **Agent definitions**: `agents/*.md` (Markdown with YAML frontmatter)
- **Core libraries**: `lib/*.js` (ES modules)
- **CLI tools**: `bin/*.js` (Node.js executables)
- **Tests**: `scripts/test.js` (single test runner)
- **Templates**: `templates/` (config templates)

### JavaScript Style

#### Module System
```javascript
// ✓ Use ES modules (type: "module" in package.json)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ✓ Named exports preferred
export class ContextStore { }
export function createAgentRegistry() { }
export const PRIORITY_LEVELS = { };

// ✗ Avoid default exports
export default SomeClass;  // Don't do this
```

#### Imports
```javascript
// ✓ Node.js built-ins use node: prefix
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// ✓ Third-party packages without prefix
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// ✓ Local modules with .js extension
import { SessionContextManager } from './session-context.js';
```

#### Formatting
- **Indentation**: 2 spaces (no tabs)
- **Line length**: No strict limit (~100-120 chars recommended)
- **Semicolons**: Use semicolons
- **Quotes**: Single quotes for strings
- **Template literals**: For string interpolation

```javascript
// ✓ Good
const message = `Session ${sessionId} started`;
const path = join(basePath, 'sessions');

// ✗ Avoid
const message = "Session " + sessionId + " started";
```

#### Naming Conventions
```javascript
// Classes: PascalCase
class ContextStore { }
class SessionContextManager { }

// Functions/variables: camelCase
function createAgentRegistry() { }
const sessionId = generateId();

// Constants: UPPER_SNAKE_CASE
export const PRIORITY_LEVELS = { };
export const SESSION_STATES = { };

// Private methods: _prefixUnderscore
_initDirs() { }
_loadIndex() { }
```

#### JSDoc Comments
```javascript
/**
 * Generate content hash for deduplication
 * @param {object} item - Item to hash
 * @returns {string} SHA-256 hash prefix (16 chars)
 */
function contentHash(item) {
  // Implementation
}

/**
 * Enhanced context storage with indexing and deduplication
 */
export class ContextStore {
  /**
   * @param {object} options
   * @param {string} options.basePath - Base path for context storage
   * @param {boolean} options.enableIndex - Whether to maintain indexes
   */
  constructor(options = {}) { }
}
```

#### Error Handling
```javascript
// ✓ Try-catch for file operations
try {
  return JSON.parse(readFileSync(indexPath, 'utf-8'));
} catch {
  return this._createEmptyIndex();
}

// ✓ Graceful degradation
if (!existsSync(path)) {
  mkdirSync(path, { recursive: true });
}

// ✓ Validation with helpful errors
if (!input.findings || !Array.isArray(input.findings)) {
  throw new Error('Input validation failed: findings must be an array');
}
```

### Agent Markdown Files

#### Frontmatter Structure
```yaml
---
name: agent-name
description: When to use this agent...
model: opus|sonnet|haiku
color: orange|cyan|blue|green|purple
tools:
  # GoodFlows tools
  - goodflows_context_query
  - goodflows_session_start
  # Linear MCP tools (use server_toolname format)
  - linear_create_issue
  - linear_update_issue
  # Serena MCP tools (optional)
  - serena_find_symbol
triggers:
  - "trigger phrase one"
  - "trigger phrase two"
---
```

#### MCP Tool Naming
```markdown
# ✓ Current convention (server_toolname)
goodflows_context_query
linear_create_issue
serena_find_symbol

# ✗ Old convention (don't use)
mcp__plugin_serena_serena__find_symbol
mcp__plugin_linear_linear__create_issue
```

## Development Workflow

### Adding New Features
1. **Update lib/** - Add/modify core functionality
2. **Update agents/** - Modify agent instructions if needed
3. **Update CLAUDE.md** - Document new features for agents
4. **Update README.md** - User-facing documentation
5. **Test** - Run `npm test` to validate

### Agent Communication
Agents communicate via:
- **Session context**: `goodflows_session_get_context` / `goodflows_session_set_context`
- **Shared memory**: `.goodflows/context/` storage
- **Linear issues**: Reference by issue ID

### File Structure Patterns
```javascript
// ✓ Standard module structure
/**
 * Module description
 * @module goodflows/lib/module-name
 */

import { dependencies } from 'packages';

// Constants first
export const CONSTANTS = { };

// Helper functions (private if needed)
function helperFunction() { }

// Main classes
export class MainClass { }

// Factory functions
export function createInstance() { }
```

## Common Patterns

### Session Management
```javascript
import { SessionContextManager } from './session-context.js';

const session = new SessionContextManager();
const sessionId = session.start({ trigger: 'code-review' });
session.set('findings.all', findings);
const checkpoint = session.checkpoint('before_fixes');
session.complete({ totalIssues: 5 });
```

### Priority Queue Usage
```javascript
import { createAgentRegistry } from './agent-registry.js';

const registry = createAgentRegistry();
registry.createQueue(findings, { priorityThreshold: PRIORITY.HIGH });
await registry.processQueue(async (finding) => {
  return await createIssue(finding);
});
```

### Context Store Operations
```javascript
import { ContextStore } from './context-store.js';

const store = new ContextStore({ basePath: '.goodflows/context' });
const hash = store.addFinding(finding);
const duplicates = store.checkDuplicate(finding);
const results = store.queryFindings({ type: 'security', status: 'open' });
```

## Important Notes

- **Node version**: Requires >= 18.0.0
- **Module type**: ES modules only (`type: "module"`)
- **File extensions**: Always use `.js` in imports
- **MCP servers**: Configure in `.claude/settings.local.json` or `~/.claude/settings.json`
- **No TypeScript**: Project uses pure JavaScript with JSDoc
- **No formal linter**: Code style enforced manually (future: add ESLint)

## Resources

- **Project docs**: CLAUDE.md (comprehensive agent guide)
- **User docs**: README.md
- **Package config**: package.json
- **Build config**: Makefile
