# Project: GoodFlows

## Vision
A multi-agent AI system for automated code review, issue tracking, and fix application. Integrates CodeRabbit, Linear, and Claude models for seamless developer workflows.

## Core Value
Enable AI agents to collaborate effectively on code quality tasks with persistent context, pattern learning, and cross-LLM handoff capabilities.

## Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    review-orchestrator (Sonnet)              │
│     Phase 1: Review → Phase 2: Categorize → Phase 3: Issues │
├─────────────────────────────────────────────────────────────┤
│              Agent Registry (Schemas, Sessions)              │
├─────────────────────────────────────────────────────────────┤
│       issue-creator (Haiku)  │  auto-fixer (Opus)           │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack
| Technology | Purpose | Notes |
|------------|---------|-------|
| Node.js | Runtime | ES Modules, v18+ |
| MCP Server | AI Integration | Model Context Protocol |
| Linear API | Issue Tracking | Bidirectional sync |
| CodeRabbit | Code Review | AI-powered analysis |
| Vitest | Testing | Unit & integration |

## Key Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| MCP Protocol | Standard AI tool interface | 2025 |
| JSONL Storage | Partitioned findings, fast queries | 2025 |
| GSD Framework | Phase-based execution with atomic commits | 2025 |
| LLM Handoff | Cross-tool context preservation | 2025 |

## Boundaries
### DO
- Context management for AI agents
- Fix pattern learning and recommendation
- Session tracking across LLM switches
- Linear issue synchronization
- GSD phase/plan execution

### DON'T
- Replace CI/CD pipelines
- Handle production deployments
- Store sensitive credentials
