from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
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

router = APIRouter(prefix="/api/ai", tags=["AI Engine"])

rag_retriever = RAGRetriever()

class GenerateSQLRequest(BaseModel):
    question: str
    schema_context: Dict[str, Any]
    conversation_history: Optional[List[Dict[str, str]]] = None
    previous_sql: Optional[str] = None
    provider: Optional[str] = None
    api_key: Optional[str] = None

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
    content: str
    metadata: Optional[Dict[str, Any]] = None

class QueryRAGRequest(BaseModel):
    project_id: str
    query: str
    top_k: Optional[int] = 5

class InsightsRequest(BaseModel):
    rows: List[Dict[str, Any]]
    columns: List[str]
    query: Optional[str] = None

@router.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "ai-service",
        "version": "1.0.0"
    }

@router.post("/generate-sql")
def generate_sql(req: GenerateSQLRequest):
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
    try:
        return rag_retriever.index_document(
            content=req.content,
            metadata=req.metadata or {},
            project_id=req.project_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rag/query")
def query_rag(req: QueryRAGRequest):
    try:
        return {
            "results": rag_retriever.retrieve(
                query=req.query,
                project_id=req.project_id,
                top_k=req.top_k or 5
            )
        }
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
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file extension: {filename}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"File parsing error: {str(e)}")
