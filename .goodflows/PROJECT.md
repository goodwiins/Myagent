# Project: Multimodal Enterprise RAG System

## Vision
A production-ready, enterprise-grade Retrieval-Augmented Generation system that processes and analyzes multimodal content (text, images, audio, video) with advanced knowledge graph capabilities, hybrid search, and comprehensive evaluation frameworks.

## Core Value
Enable organizations to unlock the full value of their collective knowledge across all modalities with sub-second search response times and enterprise-grade security.

## Architecture
```
Frontend (Next.js 15) ───── API (FastAPI) ───── Workers (Celery)
         │                    │                    │
         ▼                    ▼                    ▼
     PostgreSQL ─────── Neo4j (Graph) ─────── Qdrant (Vector)
```

## Tech Stack
| Technology | Purpose | Notes |
|------------|---------|-------|
| Next.js 15 | Frontend | App Router, TS, Tailwind |
| FastAPI | Backend | Python 3.11+, Async |
| Qdrant | Vector DB | Semantic search |
| Neo4j | Knowledge Graph | Entity relationships |
| PostgreSQL | Metadata | Relational data |
| Celery | Background Jobs | Async processing |
| CrewAI | Multi-Agent | Specialized workflows |

## Key Decisions
| Decision | Rationale | Date | Phase |
|----------|-----------|------|-------|
| Next.js 15 | Modern performance & DX | 2025 | v1.0 |
| Hybrid Search | Combine vector/graph/keyword | 2025 | v1.0 |
| Evaluation-First | RAG Triad for quality | 2025 | v1.0 |
| Multi-modality | PDF, Image, Audio, Video | 2025 | v1.0 |

## Boundaries
### DO
- Multimodal ingestion & processing
- Hybrid search (Vector + Graph + Keyword)
- Real-time quality evaluation
- Enterprise security & Multi-tenancy
- Thread summarization & Bulk operations

### DON'T
- Replace primary storage systems
- Handle raw video streaming (processing only)
- Replace manual document approval workflows
