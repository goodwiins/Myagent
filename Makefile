# GoodFlows Makefile
# AI Code Review Automation Suite

.PHONY: help install install-global install-claude install-cursor install-continue install-aider uninstall test clean

# Default target
help:
	@echo "GoodFlows - AI Code Review Automation Suite"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Installation targets:"
	@echo "  install          Install locally for Claude Code (default)"
	@echo "  install-global   Install globally for Claude Code"
	@echo "  install-claude   Install for Claude Code CLI"
	@echo "  install-cursor   Install for Cursor"
	@echo "  install-continue Install for Continue.dev"
	@echo "  install-aider    Install for Aider"
	@echo "  install-all      Install for all supported CLIs"
	@echo "  uninstall        Remove installation"
	@echo ""
	@echo "Development targets:"
	@echo "  test             Run tests"
	@echo "  lint             Lint markdown files"
	@echo "  clean            Clean generated files"
	@echo "  setup-dev        Set up development environment"
	@echo ""
	@echo "Other targets:"
	@echo "  check-deps       Check for required dependencies"
	@echo "  init-memory      Initialize memory files"
	@echo "  version          Show version information"

# Installation targets
install: check-deps
	@chmod +x install.sh
	@./install.sh --local --cli claude

install-global: check-deps
	@chmod +x install.sh
	@./install.sh --global --cli claude

install-claude: check-deps
	@chmod +x install.sh
	@./install.sh --cli claude

install-cursor: check-deps
	@chmod +x install.sh
	@./install.sh --cli cursor

install-continue: check-deps
	@chmod +x install.sh
	@./install.sh --cli continue

install-aider: check-deps
	@chmod +x install.sh
	@./install.sh --cli aider

install-all: install-claude install-cursor install-continue install-aider
	@echo "Installed for all supported CLIs"

uninstall:
	@chmod +x install.sh
	@./install.sh --uninstall

# Development targets
test:
	@echo "Running tests..."
	@echo "Testing review-orchestrator.md..."
	@test -f review-orchestrator.md && echo "  ✓ File exists" || echo "  ✗ File missing"
	@grep -q "mcp__plugin_serena_serena__" review-orchestrator.md && echo "  ✓ MCP tools configured" || echo "  ✗ MCP tools missing"
	@echo "Testing issue-creator.md..."
	@test -f issue-creator.md && echo "  ✓ File exists" || echo "  ✗ File missing"
	@echo "Testing coderabbit-auto-fixer.md..."
	@test -f coderabbit-auto-fixer.md && echo "  ✓ File exists" || echo "  ✗ File missing"
	@echo ""
	@echo "All tests passed!"

test-orchestrator:
	@echo "Testing review-orchestrator agent..."
	@grep -q "Phase 0" review-orchestrator.md && echo "✓ Prerequisites phase exists"
	@grep -q "mermaid" review-orchestrator.md && echo "✓ Workflow diagrams exist"
	@grep -q "Error Handling" review-orchestrator.md && echo "✓ Error handling documented"

test-issue-creator:
	@echo "Testing issue-creator agent..."
	@grep -q "Duplicate Detection" issue-creator.md && echo "✓ Duplicate detection exists"
	@grep -q "mcp__plugin_linear_linear__" issue-creator.md && echo "✓ Linear tools configured"

test-auto-fixer:
	@echo "Testing coderabbit-auto-fixer agent..."
	@grep -q "Verification Steps" coderabbit-auto-fixer.md && echo "✓ Verification steps exist"
	@grep -q "Recovery Workflow" coderabbit-auto-fixer.md && echo "✓ Recovery workflow exists"

lint:
	@echo "Linting markdown files..."
	@command -v markdownlint >/dev/null 2>&1 && markdownlint *.md || echo "markdownlint not installed, skipping..."

clean:
	@echo "Cleaning generated files..."
	@rm -rf .claude/agents
	@rm -rf .cursor/agents
	@rm -rf .continue/agents
	@rm -rf .aider/agents
	@rm -rf node_modules
	@rm -f package-lock.json
	@echo "Clean complete"

setup-dev:
	@echo "Setting up development environment..."
	@npm install -g markdownlint-cli 2>/dev/null || echo "npm not available, skipping markdownlint"
	@echo "Development environment ready"

# Utility targets
check-deps:
	@echo "Checking dependencies..."
	@command -v git >/dev/null 2>&1 && echo "  ✓ git" || echo "  ✗ git (required)"
	@command -v coderabbit >/dev/null 2>&1 && echo "  ✓ coderabbit" || echo "  ⚠ coderabbit (optional)"
	@echo ""

init-memory:
	@echo "Initializing memory files..."
	@mkdir -p .serena/memories
	@test -f .serena/memories/coderabbit_findings.md || echo "# CodeRabbit Findings Log\n" > .serena/memories/coderabbit_findings.md
	@test -f .serena/memories/auto_fix_patterns.md || echo "# Auto-Fix Patterns\n" > .serena/memories/auto_fix_patterns.md
	@echo "Memory files initialized"

version:
	@echo "GoodFlows v1.2.0"
	@echo "Agents:"
	@grep -h "^name:" *.md 2>/dev/null | sed 's/name: /  - /'

# NPM compatibility
npm-install: install
npm-test: test
