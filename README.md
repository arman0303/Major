# Conversational SQL Analytics Assistant

A complete, production-grade AI-powered database analytics application that enables natural language querying, automated schema creation, complex multi-table joins, interactive data visualizations, and contextual multi-turn conversations.

---

## 🌟 Key Features

1. **Natural Language to PostgreSQL Engine**:
   - Understands plain English questions and translates them into optimal PostgreSQL queries.
   - Handles multi-table `JOIN`s, `LEFT JOIN`s, Common Table Expressions (`WITH`), `GROUP BY`, `HAVING`, and analytic window functions (`DENSE_RANK() OVER ...`).
   - Includes conversational memory for follow-ups (e.g. *"Show only IT employees"*, *"Sort them by salary"*, *"Show the top five"*).

2. **Security & Guardrail Execution Pipeline**:
   - AST validation via **SQLGlot** preventing injection attacks, dangerous functions (`pg_sleep`), and unauthorized schema drops.
   - Read-only `SELECT` queries auto-execute safely.
   - `INSERT`, `UPDATE`, `DELETE`, and `DROP` statements strictly trigger interactive user confirmation modals with affected record impact previews.

3. **Multi-Format Data Upload**:
   - Ingests **JSON** arrays, **CSV** files, and tabular **PDF** documents directly into real PostgreSQL database tables with automatic type inference.

4. **Interactive Recharts Visualization**:
   - Real-time chart recommendation based on query results: Bar charts, Grouped/Stacked bars, Line graphs, Area charts, Pie & Donut charts, and KPI summary cards.
   - One-click CSV export and pagination.

5. **Natural Language Database Creation**:
   - Describe requirements (e.g. *"Create a company management system with employees and departments"*). The AI creates normalized entities, primary/foreign keys, and executable DDL.

6. **Interactive 3-Panel ChatGPT + Metabase Layout**:
   - Left Sidebar: Project management, database explorer, chat threads, dashboards.
   - Central Workspace: Multi-turn conversational interface with query badges and explanations.
   - Right Inspector Panel: Real-time query results table, chart visualizer, and live SQL editor.

---

## 🏗️ Architecture Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Shadcn/UI style, Lucide Icons, Recharts, TanStack Query.
- **Backend API**: Node.js, Express.js, TypeScript, JWT auth, bcrypt, Zod validation, pg connection pool.
- **AI Microservice**: Python 3.12, FastAPI, LangChain, LangGraph, SQLGlot, Pandas, PyPDF.
- **Database**: PostgreSQL 16 with pgvector extension (with automatic dual-mode local resilience).
- **DevOps**: Docker, Docker Compose, Nginx.

---

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)
```bash
cp .env.example .env
docker-compose up --build
```
Access the application at:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`
- AI Microservice: `http://localhost:8000/docs`

### Option 2: Local Development
```bash
# 1. Start AI Microservice
cd ai-service
.\venv\Scripts\activate
uvicorn app.main:app --port 8000 --reload

# 2. Start Backend API
cd backend
npm run dev

# 3. Start Frontend UI
cd frontend
npm run dev
```

---

## 🧪 Automated Verification Suite

Run the full end-to-end verification covering all 25 critical scenarios:
```bash
# Run 25 Critical Workflows Test
npx tsx backend/tests/e2e_verification.ts

# Run AI Service Unit Tests
cd ai-service
.\venv\Scripts\pytest
```

---

## 📂 Project Structure
```
├── frontend/          # React 18 + Vite + Tailwind + Recharts
├── backend/           # Node.js + Express + TypeScript + Zod
├── ai-service/        # Python 3.12 + FastAPI + LangChain + SQLGlot
├── database/          # Migrations (001_initial_schema.sql) and seeds
├── sample-data/       # JSON, CSV, and tabular datasets
├── docs/              # System architecture, API, and DB documentation
├── docker-compose.yml # Container orchestration
└── README.md
```
