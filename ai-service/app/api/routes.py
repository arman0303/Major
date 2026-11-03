"""
AI Service API Routes — FastAPI router with all AI endpoints.
"""
from typing import Dict, Any, List, Optional
import json
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from starlette.responses import StreamingResponse
from pydantic import BaseModel

from ..sql.generator import SQLGenerator
from ..sql.validator import SQLValidator
from ..sql.explainer import SQLExplainer
from ..sql.corrector import SQLCorrector
from ..schema.creator import SchemaCreator
from ..visualization.recommender import ChartRecommender
from ..analytics.insights import AnalyticsEngine
from ..rag.retriever import RAGRetriever
from ..ingestion.parsers import DataParser
from ..llm.provider import LLMProvider
from ..chat.intent_router import IntentRouter
from ..chat.response_generator import ResponseGenerator

router = APIRouter(prefix="/api/ai", tags=["AI Engine"])

# Shared RAG retriever instance (in-memory; swap for pgvector retriever in production)
rag_retriever = RAGRetriever()


# ── Request Models ─────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    """Unified chat endpoint — handles all intent types."""
    message: str
    schema_context: Dict[str, Any] = {}
    conversation_history: Optional[List[Dict[str, str]]] = None
    previous_sql: Optional[str] = None
    project_id: Optional[str] = None
    user_id: Optional[str] = None
    has_uploaded_docs: Optional[bool] = False
    provider: Optional[str] = None
    api_key: Optional[str] = None


class GenerateSQLRequest(BaseModel):
    question: str
    schema_context: Dict[str, Any]
    conversation_history: Optional[List[Dict[str, str]]] = None
    previous_sql: Optional[str] = None
    provider: Optional[str] = None
    api_key: Optional[str] = None


class ValidateSQLRequest(BaseModel):
    sql: str
    schema_context: Optional[Dict[str, Any]] = None
    allowed_tables: Optional[List[str]] = None


class ExplainSQLRequest(BaseModel):
    sql: str
    schema_context: Optional[Dict[str, Any]] = None
    provider: Optional[str] = None
    api_key: Optional[str] = None


class SuggestChartRequest(BaseModel):
    rows: List[Dict[str, Any]]
    columns: List[str]
    query_intent: Optional[str] = None


class CorrectSQLRequest(BaseModel):
    failed_sql: str
    error_message: str
    schema_context: Dict[str, Any]
    provider: Optional[str] = None
    api_key: Optional[str] = None


class GenerateSchemaRequest(BaseModel):
    prompt: str
    provider: Optional[str] = None
    api_key: Optional[str] = None


class IndexDocumentRequest(BaseModel):
    project_id: str
    user_id: Optional[str] = None
    file_id: Optional[str] = None
    content: str
    metadata: Optional[Dict[str, Any]] = None
    chunk_size: Optional[int] = 800
    chunk_overlap: Optional[int] = 100


class QueryRAGRequest(BaseModel):
    project_id: str
    user_id: Optional[str] = None
    query: str
    top_k: Optional[int] = 5


class InsightsRequest(BaseModel):
    rows: List[Dict[str, Any]]
    columns: List[str]
    query: Optional[str] = None


class GenerateTitleRequest(BaseModel):
    message: str
    provider: Optional[str] = None
    api_key: Optional[str] = None


class SynthesizeAnswerRequest(BaseModel):
    question: str
    sql: str
    rows: List[Dict[str, Any]]
    columns: List[str]
    row_count: int
    provider: Optional[str] = None
    api_key: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "ai-service",
        "version": "2.0.0"
    }


@router.get("/provider-status")
def provider_status(provider: Optional[str] = None, api_key: Optional[str] = None):
    """
    Check whether an LLM provider is actually authenticated and capable of generating responses.
    Performs a real lightweight probe request rather than only checking object initialization.
    """
    llm = LLMProvider(provider=provider, api_key=api_key)
    health = llm.check_health()
    return health


@router.post("/chat")
def unified_chat(req: ChatRequest):
    """
    Unified chat endpoint that:
    1. Classifies intent (sql_analytics, document_qa, general_knowledge, etc.)
    2. Retrieves relevant document chunks if needed
    3. Routes to the correct handler
    4. Returns a structured response

    This replaces the old /generate-sql endpoint for conversational use.
    """
    llm = LLMProvider(provider=req.provider, api_key=req.api_key)
    router_instance = IntentRouter(provider=llm)
    generator = ResponseGenerator(provider=llm)

    # 1. Classify intent
    classification = router_instance.classify(
        message=req.message,
        has_uploaded_docs=req.has_uploaded_docs or False,
        conversation_history=req.conversation_history,
        schema_context=req.schema_context,
    )
    intent = classification["intent"]

    # 2. Retrieve document chunks if document QA or hybrid
    document_chunks = []
    if intent in ("document_qa", "hybrid") and req.project_id:
        try:
            results = rag_retriever.retrieve(
                query=req.message,
                project_id=req.project_id,
                user_id=req.user_id,
                top_k=6,
            )
            document_chunks = results
        except Exception as e:
            # Non-fatal; continue without chunks
            pass

    # 3. Generate response
    try:
        response = generator.generate(
            intent=intent,
            message=req.message,
            schema_context=req.schema_context,
            conversation_history=req.conversation_history or [],
            document_chunks=document_chunks,
            previous_sql=req.previous_sql,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Response generation failed: {str(e)}")

    return {
        **response,
        "intent": intent,
        "query_intent_description": response.get("intent") if intent == "sql_analytics" else None,
        "intent_confidence": classification["confidence"],
        "intent_method": classification["method"],
    }


@router.post("/chat/stream")
def unified_chat_stream(req: ChatRequest):
    """
    Streaming chat endpoint that yields Server-Sent Events (SSE)
    containing metadata, operational progress, tokens, and final answer.
    """
    llm = LLMProvider(provider=req.provider, api_key=req.api_key)
    router_instance = IntentRouter(provider=llm)
    generator = ResponseGenerator(provider=llm)

    # 1. Classify intent
    classification = router_instance.classify(
        message=req.message,
        has_uploaded_docs=req.has_uploaded_docs or False,
        conversation_history=req.conversation_history,
        schema_context=req.schema_context,
    )
    intent = classification["intent"]

    # 2. Retrieve document chunks if needed
    document_chunks = []
    if intent in ("document_qa", "hybrid") and req.project_id:
        try:
            document_chunks = rag_retriever.retrieve(
                query=req.message,
                project_id=req.project_id,
                user_id=req.user_id,
                top_k=6,
            )
        except Exception:
            pass

    def event_stream():
        # First send metadata event
        meta_event = {
            "type": "meta",
            "intent": intent,
            "document_sources": [
                {
                    "document_name": c.get("metadata", {}).get("source", "Document"),
                    "page_number": c.get("metadata", {}).get("page_number", 1),
                    "chunk_id": c.get("id"),
                    "content_preview": c.get("content", "")[:200]
                }
                for c in (document_chunks or [])
            ]
        }
        yield f"data: {json.dumps(meta_event)}\n\n"

        # Stream tokens or events from generator
        for event in generator.stream_generate(
            intent=intent,
            message=req.message,
            schema_context=req.schema_context,
            conversation_history=req.conversation_history or [],
            document_chunks=document_chunks,
            previous_sql=req.previous_sql,
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/generate-title")
def generate_title(req: GenerateTitleRequest):
    """Generate a short, meaningful title from the user's first message."""
    llm = LLMProvider(provider=req.provider, api_key=req.api_key)

    if llm.has_active_api_key():
        try:
            prompt = f"""Generate a short (3-6 word) title for a chat conversation that starts with this message.
Message: "{req.message}"
Return ONLY the title, no quotes, no punctuation at the end."""
            title = llm.generate_completion(prompt, temperature=0.3).strip().strip('"').strip("'")
            # Truncate to reasonable length
            if len(title) > 60:
                title = title[:57] + "..."
            return {"title": title}
        except Exception:
            pass

    # Fallback: extract key words
    words = req.message.split()[:6]
    title = " ".join(words)
    if len(req.message) > len(title):
        title += "..."
    return {"title": title[:60]}


@router.post("/synthesize-answer")
def synthesize_answer(req: SynthesizeAnswerRequest):
    """
    Synthesize natural language answer based on actual returned rows from PostgreSQL.
    """
    llm = LLMProvider(provider=req.provider, api_key=req.api_key)
    generator = ResponseGenerator(provider=llm)
    try:
        synth = generator.synthesize_sql_answer(
            question=req.question,
            sql=req.sql,
            rows=req.rows,
            columns=req.columns,
            row_count=req.row_count,
        )
        return {"synthesized_answer": synth}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/validate-sql")
def validate_sql_endpoint(req: ValidateSQLRequest):
    """AST-based SQL validation with schema table and column verification."""
    allowed = set(req.allowed_tables) if req.allowed_tables else None
    return SQLValidator.validate_query(req.sql, allowed_tables=allowed, schema_context=req.schema_context)


@router.post("/generate-sql")
def generate_sql(req: GenerateSQLRequest):
    """Direct SQL generation endpoint (used by SQL editor)."""
    llm = LLMProvider(provider=req.provider, api_key=req.api_key)
    generator = SQLGenerator(provider=llm)
    try:
        result = generator.generate_sql(
            question=req.question,
            schema_context=req.schema_context,
            conversation_history=req.conversation_history,
            previous_sql=req.previous_sql
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/explain-sql")
def explain_sql(req: ExplainSQLRequest):
    llm = LLMProvider(provider=req.provider, api_key=req.api_key)
    explainer = SQLExplainer(provider=llm)
    try:
        return explainer.explain(req.sql, req.schema_context)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/suggest-chart")
def suggest_chart(req: SuggestChartRequest):
    try:
        return ChartRecommender.recommend(
            rows=req.rows,
            columns=req.columns,
            query_intent=req.query_intent
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/correct-sql")
def correct_sql(req: CorrectSQLRequest):
    llm = LLMProvider(provider=req.provider, api_key=req.api_key)
    corrector = SQLCorrector(provider=llm)
    try:
        return corrector.correct_sql(
            failed_sql=req.failed_sql,
            error_message=req.error_message,
            schema_context=req.schema_context
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-schema")
def generate_schema(req: GenerateSchemaRequest):
    llm = LLMProvider(provider=req.provider, api_key=req.api_key)
    creator = SchemaCreator(provider=llm)
    try:
        return creator.generate_schema_from_prompt(req.prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/rag/index")
def index_document(req: IndexDocumentRequest):
    """
    Index a document chunk into the RAG store.
    Chunks the content if it's large, then indexes each chunk.
    """
    try:
        chunk_size = req.chunk_size or 800
        chunk_overlap = req.chunk_overlap or 100
        content = req.content
        metadata = req.metadata or {}

        # Split into chunks if content is large
        if len(content) > chunk_size:
            chunks = _split_text(content, chunk_size, chunk_overlap)
        else:
            chunks = [content]

        results = []
        for i, chunk in enumerate(chunks):
            chunk_meta = {
                **metadata,
                "chunk_index": i,
                "total_chunks": len(chunks),
            }
            result = rag_retriever.index_document(
                content=chunk,
                metadata=chunk_meta,
                project_id=req.project_id,
                user_id=req.user_id,
                file_id=req.file_id,
            )
            results.append(result)

        return {
            "indexed": True,
            "chunks_indexed": len(results),
            "chunk_ids": [r["id"] for r in results],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/rag/query")
def query_rag(req: QueryRAGRequest):
    try:
        return {
            "results": rag_retriever.retrieve(
                query=req.query,
                project_id=req.project_id,
                user_id=req.user_id,
                top_k=req.top_k or 5
            )
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/rag/clear")
def clear_rag(project_id: str, user_id: Optional[str] = None):
    """Clear all indexed documents for a project."""
    try:
        rag_retriever.clear_project_index(project_id=project_id, user_id=user_id)
        return {"cleared": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/insights")
def generate_insights(req: InsightsRequest):
    try:
        return AnalyticsEngine.generate_insights(
            rows=req.rows,
            columns=req.columns,
            query=req.query
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/parse-file")
async def parse_file(file: UploadFile = File(...)):
    """Parse an uploaded file and return structured content."""
    contents = await file.read()
    filename = file.filename or "upload.data"
    lower_name = filename.lower()

    try:
        if lower_name.endswith(".csv"):
            return DataParser.parse_csv(contents, filename)
        elif lower_name.endswith(".json"):
            return DataParser.parse_json(contents, filename)
        elif lower_name.endswith(".pdf"):
            return DataParser.parse_pdf(contents, filename)
        elif lower_name.endswith(".docx"):
            return DataParser.parse_docx(contents, filename)
        elif lower_name.endswith(".txt"):
            return {
                "type": "text",
                "filename": filename,
                "content": contents.decode("utf-8", errors="replace"),
                "page_count": 1,
            }
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file extension: {filename}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"File parsing error: {str(e)}")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _split_text(text: str, chunk_size: int = 800, overlap: int = 100) -> List[str]:
    """Split text into overlapping chunks for RAG indexing."""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        # Try to break at a sentence boundary
        if end < len(text):
            for sep in [". ", ".\n", "\n\n", "\n", " "]:
                idx = text.rfind(sep, start + chunk_size // 2, end)
                if idx != -1:
                    end = idx + len(sep)
                    break
        chunks.append(text[start:end].strip())
        start = max(start + 1, end - overlap)
    return [c for c in chunks if c.strip()]
