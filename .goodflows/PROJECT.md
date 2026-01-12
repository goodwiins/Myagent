# Project: GoodFlows

## Vision
GoodFlows is a multi-agent AI system for automated code review, issue tracking, and fix application. It enables LLM-agnostic workflows that can be resumed across different AI models and IDEs.

## Core Principles
- **Tracking First**: Every operation must be tracked via GoodFlows tools
- **Context Preservation**: Session state survives context resets
- **LLM Agnostic**: Handoff between Claude, GPT-4, Gemini seamlessly
- **Priority-Based Processing**: Critical security issues before documentation

## Architecture
```
Orchestrators (Sonnet) → Subagents (Haiku/Opus)
         ↓                        ↓
    Session Context ←─────→ Tracking
         ↓
    Context Store (findings, patterns)
```

## Key Technologies
- **Node.js/ESM**: Pure ES modules for modern compatibility
- **MCP (Model Context Protocol)**: Standard tool interface for LLMs
- **Linear API**: Issue tracking integration
- **Serena MCP**: Optional code analysis

## Boundaries
- **DO**: Code review, issue creation, automated fixes, pattern tracking
- **DON'T**: Replace CI/CD, manage deployments, handle secrets directly
