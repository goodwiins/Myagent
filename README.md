# 🚀 GoodFlows

[![npm version](https://img.shields.io/npm/v/goodflows.svg)](https://www.npmjs.com/package/goodflows)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-blueviolet)](https://claude.ai/code)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

**AI-powered code review automation** with CodeRabbit, Linear, and Claude. A multi-agent system that automates your entire code review workflow.

```
   ██████╗  ██████╗  ██████╗ ██████╗ ███████╗██╗      ██████╗ ██╗    ██╗███████╗
  ██╔════╝ ██╔═══██╗██╔═══██╗██╔══██╗██╔════╝██║     ██╔═══██╗██║    ██║██╔════╝
  ██║  ███╗██║   ██║██║   ██║██║  ██║█████╗  ██║     ██║   ██║██║ █╗ ██║███████╗
  ██║   ██║██║   ██║██║   ██║██║  ██║██╔══╝  ██║     ██║   ██║██║███╗██║╚════██║
  ╚██████╔╝╚██████╔╝╚██████╔╝██████╔╝██║     ███████╗╚██████╔╝╚███╔███╔╝███████║
   ╚═════╝  ╚═════╝  ╚═════╝ ╚═════╝ ╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝
```

## ✨ Features

- **🔍 Automated Code Review** - Run CodeRabbit reviews on uncommitted changes, staged files, or PRs
- **📋 Smart Issue Creation** - Automatically create well-structured Linear issues from findings
- **🔧 Intelligent Auto-Fixing** - Safely apply fixes with verification and rollback support
- **🔄 Complete Workflow Orchestration** - End-to-end automation from review to fix
- **🧠 Memory & Learning** - Remembers past findings and fix patterns for smarter automation
- **⚡ Multi-Model Optimization** - Uses the right Claude model for each task (Opus/Sonnet/Haiku)
- **🔌 Multi-CLI Support** - Works with Claude Code, Cursor, Continue, Aider, Windsurf
- **🌐 LLM-Agnostic** - Seamlessly switch between Claude, GPT-4, Gemini, or any model
- **📡 MCP Server** - Full Model Context Protocol support for IDE integration
- **📊 Easy Tracking** - Simple helpers to track files, issues, and work progress

## 📦 Installation

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** or **bun** package manager

### NPM (Recommended)

```bash
npm install -g goodflows
```

### Bun

```bash
bun add -g goodflows
```

### Shell Script

```bash
curl -fsSL https://raw.githubusercontent.com/goodwiins/goodflows/main/install.sh | bash
```

### From Source

```bash
git clone https://github.com/goodwiins/goodflows.git
cd goodflows
npm install -g .
```

## 🚀 Quick Start

### 1. Install Agents for Your CLI

```bash
# For Claude Code (default)
goodflows install

# For other CLIs
goodflows install --cli cursor
goodflows install --cli continue
goodflows install --cli aider
goodflows install --cli windsurf

# Global installation
goodflows install --global
```

### 2. Set Up Environment Variables

```bash
export LINEAR_API_KEY="lin_api_xxxxx"
export ANTHROPIC_API_KEY="sk-ant-xxxxx"
```

### 3. Start Using

In your AI coding assistant:

```
> review and track my changes
> /fix-linear GOO-31
```

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

## 🎯 Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| `review-orchestrator` | Sonnet | Coordinates the complete review lifecycle |
| `issue-creator` | Haiku | Creates structured Linear issues from findings |
| `coderabbit-auto-fixer` | Opus | Applies fixes safely with verification |

## 📖 Commands

### CLI Commands

```bash
goodflows install          # Install agents locally
goodflows install -g       # Install agents globally
goodflows install -c cursor # Install for Cursor
goodflows uninstall        # Remove agents
goodflows init             # Initialize configuration
goodflows list             # List available agents
goodflows help             # Show help
goodflows version          # Show version
```

### In-Editor Commands

| Command | Description |
|---------|-------------|
| `review and track` | Full review workflow |
| `review my changes` | Review uncommitted changes |
| `create Linear issues` | Create issues from findings |
| `/fix-linear GOO-31` | Fix specific Linear issue |
| `auto-fix this issue` | Apply automated fix |

## 🔧 Configuration

### Initialize Config

```bash
goodflows init
```

This creates `goodflows.config.json`:

```json
{
  "team": {
    "name": "YOUR_TEAM",
    "prefix": "GOO"
  },
  "review": {
    "autoFix": false,
    "groupByFile": true,
    "priorityThreshold": 4
  },
  "memory": {
    "enabled": true,
    "path": ".serena/memories"
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LINEAR_API_KEY` | Yes | Linear API token |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `CODERABBIT_API_KEY` | No | CodeRabbit API key |

## 🔌 Supported CLIs

| CLI | Command | Status |
|-----|---------|--------|
| [Claude Code](https://claude.ai/code) | `goodflows install` | ✅ Full Support |
| [Cursor](https://cursor.sh) | `goodflows install -c cursor` | ✅ Full Support |
| [Continue.dev](https://continue.dev) | `goodflows install -c continue` | ✅ Full Support |
| [Aider](https://aider.chat) | `goodflows install -c aider` | ✅ Full Support |
| [Windsurf](https://codeium.com/windsurf) | `goodflows install -c windsurf` | ✅ Full Support |

## 📡 MCP Server

GoodFlows includes a full MCP (Model Context Protocol) server for IDE integration.

### Setup

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "goodflows": {
      "command": "npx",
      "args": ["goodflows-mcp-server"]
    }
  }
}
```

### Key MCP Tools

| Tool | Description |
|------|-------------|
| `goodflows_session_start` | Start a workflow session |
| `goodflows_track_file` | Track file operations |
| `goodflows_track_issue` | Track issue progress |
| `goodflows_start_work` | Start a work unit |
| `goodflows_complete_work` | Complete work and get summary |
| `goodflows_project_info` | Get project/GitHub context |
| `goodflows_export_handoff` | Export state for LLM handoff |
| `goodflows_generate_resume_prompt` | Generate prompt for another LLM |

### Easy Tracking

```javascript
// Track work with automatic stats
session.startWork('fix-issue', { issueId: 'GOO-53' });
session.trackFile('src/auth.ts', 'created');
session.trackFile('src/utils.ts', 'modified');
session.trackIssue('GOO-53', 'fixed');
session.completeWork({ success: true });
// Summary auto-derived: { filesCreated: 1, filesModified: 1, issuesFixed: 1 }
```

### LLM/IDE Handoff

Switch seamlessly between Claude, GPT-4, Gemini, or any LLM:

```javascript
// In Claude/Cursor - export state
goodflows_export_handoff()
goodflows_generate_resume_prompt({ style: 'detailed' })

// In GPT-4/VS Code - resume work
goodflows_session_resume({ sessionId: 'session_xxx' })
goodflows_get_tracking_summary()
```

## 📊 Priority Mapping

| Finding Type | Linear Labels | Priority |
|--------------|---------------|----------|
| `critical_security` | `security`, `critical` | P1 (Urgent) |
| `potential_issue` | `bug` | P2 (High) |
| `refactor_suggestion` | `improvement` | P3 (Normal) |
| `performance` | `performance` | P3 (Normal) |
| `documentation` | `docs` | P4 (Low) |

## 🛡️ Error Handling

GoodFlows includes comprehensive error handling:

- **Retryable errors**: Timeouts, rate limits → automatic retry with backoff
- **Fallback actions**: API down → queue locally for later
- **Partial success**: Continue workflow even if some steps fail
- **Rollback support**: Revert failed fixes automatically

## 📁 Project Structure

```
goodflows/
├── package.json              # NPM package config
├── bin/
│   ├── goodflows.js          # CLI entry point
│   └── mcp-server.js         # MCP server for IDE integration
├── agents/
│   ├── review-orchestrator.md
│   ├── issue-creator.md
│   └── coderabbit-auto-fixer.md
├── lib/
│   ├── index.js              # Library exports
│   ├── context-store.js      # Context management
│   ├── session-context.js    # Session & tracking management
│   ├── pattern-tracker.js    # Fix pattern tracking
│   └── priority-queue.js     # Priority queue for findings
├── .goodflows/               # GoodFlows context storage
│   └── context/
│       ├── sessions/         # Session data
│       ├── findings/         # Indexed findings
│       └── patterns/         # Fix patterns
├── config.json               # Default configuration
├── CLAUDE.md                 # Project documentation
├── LICENSE                   # MIT License
└── README.md
```

## 🧪 Development

```bash
# Clone repository
git clone https://github.com/goodwiins/goodflows.git
cd goodflows

# Install dependencies
npm install

# Run tests
npm test

# Link for local development
npm link
```

### Make Commands

```bash
make help              # Show all available commands
make install           # Install locally for Claude Code
make install-global    # Install globally
make install-cursor    # Install for Cursor
make install-all       # Install for all supported CLIs
make test              # Run tests
make lint              # Lint markdown files
make check-deps        # Check for required dependencies
make init-memory       # Initialize memory files
make clean             # Clean generated files
```

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines first.

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
- 🐛 [Issue Tracker](https://github.com/goodwiins/goodflows/issues)
- 💬 [Discussions](https://github.com/goodwiins/goodflows/discussions)
- 💖 [Sponsor](https://github.com/sponsors/goodwiins)

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/goodwiins">@goodwiins</a>
</p>
