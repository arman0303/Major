-- ==============================================================
-- Initial Schema Migration: 001_initial_schema.sql
-- Conversational SQL Analytics Assistant
-- ==============================================================

-- Enable pgvector extension for semantic RAG retrieval
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. User Settings Table
CREATE TABLE IF NOT EXISTS user_settings (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    default_llm_provider VARCHAR(50) DEFAULT 'gemini',
    gemini_api_key VARCHAR(255),
    openai_api_key VARCHAR(255),
    theme VARCHAR(20) DEFAULT 'dark',
    auto_execute_select BOOLEAN DEFAULT true,
    max_row_limit INTEGER DEFAULT 500,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Projects Table (Isolates datasets, schemas, and conversations per project)
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

-- 4. Datasets Table (Metadata for uploaded and created datasets)
CREATE TABLE IF NOT EXISTS datasets (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    table_name VARCHAR(150) NOT NULL,
    file_type VARCHAR(20) NOT NULL, -- 'csv', 'json', 'pdf', 'ddl'
    file_path TEXT,
    row_count INTEGER DEFAULT 0,
    schema_info JSONB, -- Inferred columns, types, sample values
    status VARCHAR(50) DEFAULT 'ready', -- 'uploading', 'processing', 'ready', 'error'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_datasets_project_id ON datasets(project_id);

-- 5. Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'New Conversation',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);

-- 6. Messages Table (Conversational turns, generated SQL, execution results, explanations)
CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system'
    content TEXT NOT NULL,
    generated_sql TEXT,
    query_result JSONB,
    visualization_config JSONB,
    explanation JSONB, -- simple_explanation, technical_explanation
    requires_confirmation BOOLEAN DEFAULT false,
    confirmation_status VARCHAR(50) DEFAULT 'none', -- 'none', 'pending', 'confirmed', 'rejected'
    error_message TEXT,
    execution_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- 7. Query History Table
CREATE TABLE IF NOT EXISTS query_history (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    raw_query TEXT,
    sql_statement TEXT NOT NULL,
    query_type VARCHAR(30) NOT NULL, -- 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DDL'
    execution_time_ms INTEGER,
    row_count INTEGER,
    status VARCHAR(50) NOT NULL, -- 'success', 'error', 'blocked'
    error_details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_query_history_project ON query_history(project_id);

-- 8. Schema Metadata Table
CREATE TABLE IF NOT EXISTS schema_metadata (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    table_name VARCHAR(150) NOT NULL,
    column_name VARCHAR(150) NOT NULL,
    data_type VARCHAR(100) NOT NULL,
    is_primary_key BOOLEAN DEFAULT false,
    is_foreign_key BOOLEAN DEFAULT false,
    foreign_table VARCHAR(150),
    foreign_column VARCHAR(150),
    description TEXT,
    sample_values JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schema_project_table ON schema_metadata(project_id, table_name);

-- 9. Relationships Table
CREATE TABLE IF NOT EXISTS relationships (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_table VARCHAR(150) NOT NULL,
    source_column VARCHAR(150) NOT NULL,
    target_table VARCHAR(150) NOT NULL,
    target_column VARCHAR(150) NOT NULL,
    relationship_type VARCHAR(50) DEFAULT 'one-to-many',
    is_confirmed BOOLEAN DEFAULT false,
    confidence FLOAT DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_relationships_project ON relationships(project_id);

-- 10. Saved Queries Table
CREATE TABLE IF NOT EXISTS saved_queries (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    sql_statement TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Dashboards Table
CREATE TABLE IF NOT EXISTS dashboards (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    layout JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. Dashboard Widgets Table
CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id VARCHAR(36) PRIMARY KEY,
    dashboard_id VARCHAR(36) NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    widget_type VARCHAR(50) NOT NULL, -- 'table', 'bar', 'line', 'pie', 'kpi', etc.
    sql_query TEXT NOT NULL,
    chart_config JSONB,
    position JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 13. Document Chunks Table (for RAG on PDFs, schema docs, business logic)
CREATE TABLE IF NOT EXISTS document_chunks (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dataset_id VARCHAR(36) REFERENCES datasets(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    metadata JSONB,
    embedding vector(768), -- Compatible with standard Gemini/OpenAI text embeddings
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doc_chunks_project ON document_chunks(project_id);

-- 14. Execution Logs Table
CREATE TABLE IF NOT EXISTS execution_logs (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sql TEXT NOT NULL,
    status VARCHAR(50) NOT NULL,
    duration_ms INTEGER,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 15. Import Logs Table
CREATE TABLE IF NOT EXISTS import_logs (
    id VARCHAR(36) PRIMARY KEY,
    dataset_id VARCHAR(36) NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL,
    rows_imported INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
