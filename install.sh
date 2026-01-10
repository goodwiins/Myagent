#!/bin/bash

# Myagent Installation Script
# Installs AI code review agents for various CLI tools

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default values
INSTALL_MODE="local"
TARGET_CLI="claude"
VERBOSE=false

# Print colored output
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Show usage
usage() {
    cat << EOF
Usage: ./install.sh [OPTIONS]

Install Myagent AI code review agents for your preferred CLI tool.

OPTIONS:
    -h, --help          Show this help message
    -g, --global        Install globally (to ~/.config/)
    -l, --local         Install locally (to current project, default)
    -c, --cli CLI       Target CLI: claude, cursor, continue, aider (default: claude)
    -v, --verbose       Enable verbose output
    --uninstall         Remove installed agents

EXAMPLES:
    ./install.sh                    # Local install for Claude Code
    ./install.sh --global           # Global install for Claude Code
    ./install.sh --cli cursor       # Install for Cursor
    ./install.sh --cli continue     # Install for Continue.dev
    ./install.sh --uninstall        # Remove installation

EOF
}

# Parse arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                usage
                exit 0
                ;;
            -g|--global)
                INSTALL_MODE="global"
                shift
                ;;
            -l|--local)
                INSTALL_MODE="local"
                shift
                ;;
            -c|--cli)
                TARGET_CLI="$2"
                shift 2
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            --uninstall)
                uninstall
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
}

# Get installation directory based on CLI and mode
get_install_dir() {
    local cli=$1
    local mode=$2

    case $cli in
        claude)
            if [[ $mode == "global" ]]; then
                echo "$HOME/.claude/agents"
            else
                echo "./.claude/agents"
            fi
            ;;
        cursor)
            if [[ $mode == "global" ]]; then
                echo "$HOME/.cursor/agents"
            else
                echo "./.cursor/agents"
            fi
            ;;
        continue)
            if [[ $mode == "global" ]]; then
                echo "$HOME/.continue/agents"
            else
                echo "./.continue/agents"
            fi
            ;;
        aider)
            if [[ $mode == "global" ]]; then
                echo "$HOME/.aider/agents"
            else
                echo "./.aider/agents"
            fi
            ;;
        *)
            print_error "Unknown CLI: $cli"
            exit 1
            ;;
    esac
}

# Check prerequisites
check_prerequisites() {
    print_info "Checking prerequisites..."

    local missing=()

    # Check for required tools
    if ! command -v git &> /dev/null; then
        missing+=("git")
    fi

    # Check for optional tools
    if ! command -v coderabbit &> /dev/null; then
        print_warning "CodeRabbit CLI not found. Install with: pip install coderabbit-cli"
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        print_error "Missing required tools: ${missing[*]}"
        exit 1
    fi

    print_success "Prerequisites check passed"
}

# Create directory structure
create_directories() {
    local install_dir=$1

    print_info "Creating directory structure..."

    mkdir -p "$install_dir"
    mkdir -p "$install_dir/../memories"

    if [[ $VERBOSE == true ]]; then
        print_info "Created: $install_dir"
    fi
}

# Copy agent files
copy_agents() {
    local install_dir=$1

    print_info "Copying agent files..."

    # Copy agent definitions
    cp "$SCRIPT_DIR/review-orchestrator.md" "$install_dir/"
    cp "$SCRIPT_DIR/issue-creator.md" "$install_dir/"
    cp "$SCRIPT_DIR/coderabbit-auto-fixer.md" "$install_dir/"

    # Copy documentation
    if [[ -f "$SCRIPT_DIR/CLAUDE.md" ]]; then
        cp "$SCRIPT_DIR/CLAUDE.md" "$install_dir/../"
    fi

    print_success "Agent files copied to $install_dir"
}

# Create CLI-specific configuration
create_cli_config() {
    local cli=$1
    local install_dir=$2

    print_info "Creating $cli configuration..."

    case $cli in
        claude)
            create_claude_config "$install_dir"
            ;;
        cursor)
            create_cursor_config "$install_dir"
            ;;
        continue)
            create_continue_config "$install_dir"
            ;;
        aider)
            create_aider_config "$install_dir"
            ;;
    esac
}

# Create Claude Code CLI configuration
create_claude_config() {
    local install_dir=$1
    local config_dir="$(dirname "$install_dir")"

    cat > "$config_dir/settings.json" << 'EOF'
{
  "agents": {
    "review-orchestrator": {
      "enabled": true,
      "triggers": [
        "review and track",
        "run coderabbit",
        "full code review"
      ]
    },
    "issue-creator": {
      "enabled": true,
      "triggers": [
        "create Linear issues",
        "track in Linear"
      ]
    },
    "coderabbit-auto-fixer": {
      "enabled": true,
      "triggers": [
        "/fix-linear",
        "auto-fix"
      ]
    }
  },
  "memory": {
    "enabled": true,
    "path": ".serena/memories"
  }
}
EOF

    print_success "Claude Code configuration created"
}

# Create Cursor configuration
create_cursor_config() {
    local install_dir=$1
    local config_dir="$(dirname "$install_dir")"

    cat > "$config_dir/agents.json" << 'EOF'
{
  "version": "1.0",
  "agents": [
    {
      "name": "review-orchestrator",
      "file": "agents/review-orchestrator.md",
      "model": "claude-3-5-sonnet",
      "triggers": ["@review", "@coderabbit"]
    },
    {
      "name": "issue-creator",
      "file": "agents/issue-creator.md",
      "model": "claude-3-haiku",
      "triggers": ["@linear", "@issue"]
    },
    {
      "name": "coderabbit-auto-fixer",
      "file": "agents/coderabbit-auto-fixer.md",
      "model": "claude-3-opus",
      "triggers": ["@fix", "@autofix"]
    }
  ]
}
EOF

    print_success "Cursor configuration created"
}

# Create Continue.dev configuration
create_continue_config() {
    local install_dir=$1
    local config_dir="$(dirname "$install_dir")"

    cat > "$config_dir/config.json" << 'EOF'
{
  "customCommands": [
    {
      "name": "review",
      "description": "Run full code review workflow",
      "prompt": "Use the review-orchestrator agent to review and track all changes"
    },
    {
      "name": "fix-linear",
      "description": "Fix a Linear issue",
      "prompt": "Use the coderabbit-auto-fixer agent to fix issue {input}"
    },
    {
      "name": "create-issues",
      "description": "Create Linear issues from findings",
      "prompt": "Use the issue-creator agent to create Linear issues from the review findings"
    }
  ],
  "contextProviders": [
    {
      "name": "coderabbit",
      "params": {
        "agentsDir": "agents/"
      }
    }
  ]
}
EOF

    print_success "Continue.dev configuration created"
}

# Create Aider configuration
create_aider_config() {
    local install_dir=$1
    local config_dir="$(dirname "$install_dir")"

    cat > "$config_dir/.aider.conf.yml" << 'EOF'
# Myagent Aider Configuration

# Model settings
model: claude-3-5-sonnet-20241022

# Custom prompts directory
prompts-dir: agents/

# Git settings
auto-commits: false
dirty-commits: false

# Custom commands
aliases:
  review: "/read agents/review-orchestrator.md && review and track all changes"
  fix: "/read agents/coderabbit-auto-fixer.md && fix the issue"
  issues: "/read agents/issue-creator.md && create Linear issues"
EOF

    print_success "Aider configuration created"
}

# Create initial memory files
create_memory_files() {
    local install_dir=$1
    local memory_dir="$install_dir/../memories"

    if [[ ! -f "$memory_dir/coderabbit_findings.md" ]]; then
        cat > "$memory_dir/coderabbit_findings.md" << 'EOF'
# CodeRabbit Findings Log

This file tracks all code review findings for duplicate detection and history.

## Format

```
## [ISSUE-ID] Issue Title
- **File**: path/to/file.ext
- **Lines**: X-Y
- **Type**: security|bug|refactor|performance|docs
- **Status**: open|in-progress|resolved
- **Created**: YYYY-MM-DD
```

---

EOF
    fi

    if [[ ! -f "$memory_dir/auto_fix_patterns.md" ]]; then
        cat > "$memory_dir/auto_fix_patterns.md" << 'EOF'
# Auto-Fix Patterns

Reusable fix patterns for common issues.

## Security Patterns

### API Key Exposure
- **Pattern**: Hardcoded API key in source
- **Fix**: Replace with environment variable
- **Template**:
  ```python
  # Before
  api_key = "sk-xxx"

  # After
  import os
  api_key = os.environ.get("API_KEY")
  if not api_key:
      raise ValueError("API_KEY environment variable required")
  ```

## Code Quality Patterns

### Missing Error Handling
- **Pattern**: Unhandled exception in async code
- **Fix**: Add try/except with logging

---

EOF
    fi

    print_success "Memory files initialized"
}

# Main installation function
install() {
    print_info "Starting Myagent installation..."
    print_info "Mode: $INSTALL_MODE, Target CLI: $TARGET_CLI"

    # Get installation directory
    local install_dir
    install_dir=$(get_install_dir "$TARGET_CLI" "$INSTALL_MODE")

    # Run installation steps
    check_prerequisites
    create_directories "$install_dir"
    copy_agents "$install_dir"
    create_cli_config "$TARGET_CLI" "$install_dir"
    create_memory_files "$install_dir"

    echo ""
    print_success "Installation complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Set environment variables:"
    echo "     export LINEAR_API_KEY=\"your-linear-api-key\""
    echo "     export ANTHROPIC_API_KEY=\"your-anthropic-api-key\""
    echo ""
    echo "  2. Start using the agents:"
    case $TARGET_CLI in
        claude)
            echo "     > review and track my changes"
            ;;
        cursor)
            echo "     @review check my code"
            ;;
        continue)
            echo "     /review"
            ;;
        aider)
            echo "     /review"
            ;;
    esac
    echo ""
}

# Uninstall function
uninstall() {
    print_info "Uninstalling Myagent..."

    local dirs_to_remove=(
        "./.claude/agents"
        "./.cursor/agents"
        "./.continue/agents"
        "./.aider/agents"
        "$HOME/.claude/agents/review-orchestrator.md"
        "$HOME/.claude/agents/issue-creator.md"
        "$HOME/.claude/agents/coderabbit-auto-fixer.md"
    )

    for dir in "${dirs_to_remove[@]}"; do
        if [[ -e "$dir" ]]; then
            rm -rf "$dir"
            print_info "Removed: $dir"
        fi
    done

    print_success "Uninstallation complete"
}

# Run
parse_args "$@"
install
