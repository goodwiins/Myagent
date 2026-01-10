# 🤖 Myagent - AI Code Review Automation Suite

[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-blueviolet)](https://claude.ai/code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

A powerful multi-agent AI system that automates code review workflows by integrating **CodeRabbit** reviews with **Linear** issue tracking and intelligent auto-fixing capabilities.

## ✨ Features

- **🔍 Automated Code Review** - Run CodeRabbit reviews on uncommitted changes, staged files, or PRs
- **📋 Smart Issue Creation** - Automatically create well-structured Linear issues from review findings
- **🔧 Intelligent Auto-Fixing** - Safely apply fixes with verification and rollback support
- **🔄 Complete Workflow Orchestration** - End-to-end automation from review to fix
- **🧠 Memory & Learning** - Remembers past findings and fix patterns for smarter automation
- **⚡ Multi-Model Optimization** - Uses the right Claude model for each task (Opus/Sonnet/Haiku)

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    review-orchestrator                       │
│                    (Sonnet - Coordinator)                    │
│                                                              │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐  │
│   │ Phase 0  │ → │ Phase 1  │ → │ Phase 2  │ → │ Phase 3 │  │
│   │ Prereqs  │   │ Review   │   │Categorize│   │ Issues  │  │
│   └──────────┘   └──────────┘   └──────────┘   └────┬────┘  │
│                                                      │       │
│                    ┌─────────────────────────────────┤       │
│                    ↓                                 ↓       │
│            ┌──────────────┐                 ┌──────────────┐ │
│            │ issue-creator│                 │  auto-fixer  │ │
│            │   (Haiku)    │                 │   (Opus)     │ │
│            └──────────────┘                 └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 📦 Installation

### Quick Install (Recommended)

```bash
# Clone the repository
git clone https://github.com/yourusername/myagent.git
cd myagent

# Install for Claude Code CLI
make install

# Or use npm
npm install -g @yourusername/myagent
```

### Manual Installation

#### For Claude Code CLI

```bash
# Copy agents to your project
cp -r agents/ ~/.claude/agents/

# Or install globally
./install.sh --global
```

#### For Cursor

```bash
# Copy to Cursor's agent directory
cp -r agents/ ~/.cursor/agents/
```

#### For Continue.dev

```bash
# Add to Continue config
./install.sh --continue
```

## 🚀 Quick Start

### 1. Set Up Environment Variables

```bash
# Required
export LINEAR_API_KEY="lin_api_xxxxx"
export ANTHROPIC_API_KEY="sk-ant-xxxxx"

# Optional
export CODERABBIT_API_KEY="cr_xxxxx"
```

### 2. Run Your First Review

```bash
# In Claude Code CLI
> review and track my changes

# Or trigger specific agents
> /fix-linear GOO-31
```

## 📖 Usage

### Full Review Workflow

```
You: review and track all changes
```

This will:
1. ✅ Check prerequisites (CodeRabbit, Linear API, Git)
2. 🔍 Run CodeRabbit review on uncommitted changes
3. 📊 Categorize findings by severity (P1-P4)
4. 📝 Create Linear issues with proper labels
5. 🔧 Optionally auto-fix safe issues
6. 📋 Generate summary report

### Create Issues Only

```
You: create Linear issues from these findings
```

### Fix a Specific Issue

```
You: /fix-linear GOO-31
```

### Review Options

| Command | Description |
|---------|-------------|
| `review and track` | Full workflow |
| `review my changes` | Review uncommitted changes |
| `run coderabbit and create issues` | Review + issue creation |
| `fix the issue in GOO-XX` | Fix specific Linear issue |

## 🔧 Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LINEAR_API_KEY` | Yes | Linear API token |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `CODERABBIT_API_KEY` | No | CodeRabbit API key |
| `REVIEW_AUTO_FIX` | No | Enable auto-fix (`true`/`false`) |
| `REVIEW_PRIORITY_THRESHOLD` | No | Min priority to create issues (1-4) |

### Agent Configuration

Edit `config.json` to customize behavior:

```json
{
  "team": "YOUR_TEAM",
  "labels": {
    "security": "security",
    "bug": "bug",
    "improvement": "improvement"
  },
  "options": {
    "group_by_file": true,
    "check_duplicates": true,
    "auto_fix": false
  }
}
```

## 📁 Project Structure

```
myagent/
├── README.md                 # This file
├── CLAUDE.md                 # Claude Code documentation
├── package.json              # npm package config
├── install.sh                # Installation script
├── Makefile                  # Make commands
├── config.json               # Default configuration
│
├── agents/                   # Agent definitions
│   ├── review-orchestrator.md
│   ├── issue-creator.md
│   └── coderabbit-auto-fixer.md
│
├── .claude/                  # Claude Code CLI config
│   └── settings.json
│
└── templates/                # Config templates for other CLIs
    ├── cursor/
    ├── continue/
    └── aider/
```

## 🎯 Agents

### review-orchestrator (Sonnet)

The main coordinator that orchestrates the complete workflow:
- Runs CodeRabbit reviews
- Categorizes and prioritizes findings
- Delegates to sub-agents
- Generates reports

### issue-creator (Haiku)

Fast, efficient issue creation specialist:
- Parses various input formats
- Detects duplicates via memory
- Creates well-structured Linear issues
- Handles batch processing

### coderabbit-auto-fixer (Opus)

Careful, methodical code fixer:
- Applies fixes safely with verification
- Reverts on failure
- Documents all changes
- Updates Linear status

## 🔌 Integrations

### Linear

- Automatic issue creation with proper labels
- Priority mapping (P1-P4)
- Status updates on fix completion
- Duplicate detection

### CodeRabbit

- CLI integration for local reviews
- Support for uncommitted, staged, PR, and branch reviews
- Structured output parsing

### Serena (MCP)

- Semantic code analysis
- Symbol-level editing
- Memory persistence for patterns

## 📊 Priority Mapping

| Finding Type | Linear Labels | Priority |
|--------------|---------------|----------|
| `critical_security` | `security`, `critical` | P1 (Urgent) |
| `potential_issue` | `bug` | P2 (High) |
| `refactor_suggestion` | `improvement` | P3 (Normal) |
| `performance` | `performance` | P3 (Normal) |
| `documentation` | `docs` | P4 (Low) |

## 🛡️ Error Handling

The agents include comprehensive error handling:

- **Retryable errors**: Timeouts, rate limits → automatic retry with backoff
- **Fallback actions**: API down → queue locally for later
- **Abort conditions**: Missing dependencies → clear error messages
- **Partial success**: Continue workflow even if some steps fail

## 🧪 Testing

```bash
# Run tests
make test

# Test specific agent
make test-orchestrator
make test-issue-creator
make test-auto-fixer
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [CodeRabbit](https://coderabbit.ai) - AI code review
- [Linear](https://linear.app) - Issue tracking
- [Anthropic Claude](https://anthropic.com) - AI models
- [Serena](https://github.com/serena-ai/serena) - Semantic code analysis

## 📞 Support

- 📖 [Documentation](./CLAUDE.md)
- 🐛 [Issue Tracker](https://github.com/yourusername/myagent/issues)
- 💬 [Discussions](https://github.com/yourusername/myagent/discussions)

---

Made with ❤️ by the Myagent team
