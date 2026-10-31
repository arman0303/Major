# Setup, Local Development, & Deployment Guide

## Prerequisites
- Node.js 18+ (20+ recommended)
- Python 3.10+ (3.12 recommended)
- Docker & Docker Compose (optional for containerized deployment)

---

## Quick Start (Docker Compose)

To start the full stack including PostgreSQL with pgvector, Redis, AI service, Node backend, and React frontend:

```bash
# 1. Clone repository & configure environment variables
cp .env.example .env

# 2. Build and launch all services
docker-compose up --build
```
Access the application at:
- **Frontend UI**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:5000/api](http://localhost:5000/api)
- **AI Microservice**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Manual Local Development Setup

### 1. AI Service (Python FastAPI)
```bash
cd ai-service
python -m venv venv

# Windows
.\venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --port 8000 --reload
```

### 2. Backend API (Node.js + Express)
```bash
cd backend
npm install
npm run dev
```

### 3. Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev
```

---

## Running Automated Tests

```bash
# AI Service Tests (Pytest)
cd ai-service
.\venv\Scripts\pytest

# End-to-End 25 Critical Workflows Test
npx tsx backend/tests/e2e_verification.ts
```
