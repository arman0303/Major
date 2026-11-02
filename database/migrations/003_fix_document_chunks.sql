-- Migration 003: Fix document_chunks schema mismatch
-- Migration 001 created document_chunks with minimal schema:
--   (id VARCHAR(36), project_id, dataset_id, content, metadata, embedding vector(768))
-- Migration 002 attempted to CREATE the same table with a different schema but was
-- silently ignored because the table already existed (CREATE TABLE IF NOT EXISTS).
-- This migration adds the missing columns that the RAG retriever expects.

ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS file_id TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS conversation_id TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS chunk_index INTEGER DEFAULT 0;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS page_number INTEGER;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS section TEXT;

-- Backfill file_id from dataset_id where possible
UPDATE document_chunks
SET file_id = CAST(dataset_id AS TEXT)
WHERE file_id IS NULL AND dataset_id IS NOT NULL;

-- Add missing indexes for query performance
CREATE INDEX IF NOT EXISTS idx_document_chunks_user_id ON document_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_file_id ON document_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_conversation_id ON document_chunks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_project_user ON document_chunks(project_id, user_id);
