# Conversational SQL Analytics Assistant - System Architecture

## 1. High-Level Architecture Overview

The **Conversational SQL Analytics Assistant** is built as an enterprise-grade, distributed AI analytics platform designed to bridge natural language communication with relational databases.

```
┌────────────────────────────────────────────────────────┐
│               Frontend: React 18 + Vite                │
│  Tailwind CSS | Shadcn UI | Recharts | TanStack Query  │
└───────────────────────────┬────────────────────────────┘
                            │ REST / JSON (JWT Auth)
                            ▼
┌────────────────────────────────────────────────────────┐
│             Backend API: Node.js + Express             │
│   TypeScript | Zod Validation | Auth Guardrails        │
└─────────────┬────────────────────────────┬─────────────┘
              │ Proxy / HTTP               │ SQL execution / Pool
              ▼                            ▼
┌───────────────────────────┐  ┌─────────────────────────┐
│     AI Microservice       │  │  PostgreSQL + pgvector   │
│ Python 3.12 | FastAPI     │  │   Relational Datasets    │
│ SQLGlot | LangChain       │  │   Vector Embeddings     │
│ Gemini & OpenAI Providers │  └─────────────────────────┘
└───────────────────────────┘
```

---

## 2. Subsystem Components

### A. Frontend Application (`/frontend`)
- **Framework**: React 18 with Vite and TypeScript.
- **Visuals**: Tailwind CSS, Lucide React icons, and a ChatGPT-meets-Metabase 3-panel layout.
- **Charts**: Recharts rendering Bar, Grouped/Stacked Bar, Line, Area, Pie, Donut, Scatter, and KPI cards.
- **State & Routing**: TanStack Query (React Query) and React Router 6.

### B. Core Backend Service (`/backend`)
- **Runtime**: Node.js 20+ with Express and TypeScript.
- **Authentication**: JWT access and refresh token rotation, bcrypt password hashing, session tracking.
- **Validation**: Zod schema validation on all inputs.
- **Guardrails**: Query execution permissions separating read-only SELECT from mutating CRUD.

### C. AI Microservice (`/ai-service`)
- **Runtime**: Python 3.12 with FastAPI and Uvicorn.
- **SQL Parser**: SQLGlot PostgreSQL AST parsing, syntax validation, security checks.
- **LLM Abstraction**: Configurable Google Gemini (`gemini-1.5-flash`) and OpenAI (`gpt-4o-mini`), plus an internal deterministic schema-grounded SQL engine.
- **RAG & Vector Retrieval**: Embedding generation and cosine similarity search over database schemas and document chunks.
- **Data Ingestion**: Pandas, CSV dialect detection, and PDF table extraction.

### D. Persistence Layer (`/database`)
- **Primary Database**: PostgreSQL 16 with pgvector extension.
- **Resilience**: Automated dual-mode persistence enabling seamless local development and production container deployment.
