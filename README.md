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

## 📦 Installation

### NPM (Recommended)

```bash
npm install -g goodflows
```

### Bun

```bash
bun add -g goodflows
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
├── package.json          # NPM package config
├── bin/
│   └── goodflows.js      # CLI entry point
├── agents/
│   ├── review-orchestrator.md
│   ├── issue-creator.md
│   └── coderabbit-auto-fixer.md
├── scripts/
│   ├── postinstall.js
│   └── test.js
├── config.json           # Default configuration
├── CLAUDE.md             # Project documentation
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

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/goodwiins">@goodwiins</a>
</p>
