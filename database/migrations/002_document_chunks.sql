-- Migration 002: Document Chunks, Embeddings, and Conversation Improvements
-- Run after 001_initial_schema.sql

-- =========================================================
-- Document chunks table for RAG
-- =========================================================
CREATE TABLE IF NOT EXISTS document_chunks (
    id              SERIAL PRIMARY KEY,
    file_id         TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    conversation_id TEXT,
    chunk_index     INTEGER NOT NULL DEFAULT 0,
    content         TEXT NOT NULL,
    page_number     INTEGER,
    section         TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Embedding column — added separately so it works even if pgvector is not installed
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        ALTER TABLE document_chunks
            ADD COLUMN IF NOT EXISTS embedding vector(768);
        CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
            ON document_chunks USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 50);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_document_chunks_file_id    ON document_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_project_id ON document_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id    ON document_chunks(user_id);

-- =========================================================
-- Uploaded files tracking (richer than datasets table)
-- =========================================================
CREATE TABLE IF NOT EXISTS uploaded_files (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    project_id      TEXT,
    conversation_id TEXT,
    original_name   TEXT NOT NULL,
    file_type       TEXT NOT NULL,  -- pdf | csv | json | txt
    file_size_bytes BIGINT,
    storage_path    TEXT,
    status          TEXT DEFAULT 'pending',  -- pending | indexing | ready | failed
    chunk_count     INTEGER DEFAULT 0,
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_user_id    ON uploaded_files(user_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_project_id ON uploaded_files(project_id);

-- =========================================================
-- Improve conversations table — add user_id and message_count
-- =========================================================
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_user_id    ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);

-- =========================================================
-- Improve messages table — add intent_type for routing
-- =========================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS intent_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS document_sources JSONB;

-- =========================================================
-- Schema for storing query-to-SQL examples (few-shot RAG)
-- =========================================================
CREATE TABLE IF NOT EXISTS sql_examples (
    id          SERIAL PRIMARY KEY,
    question    TEXT NOT NULL,
    sql         TEXT NOT NULL,
    tables      TEXT[],
    project_id  TEXT,
    created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
