"""
Intent Router — dynamically classifies user input into one of 8 intent categories
using LLM-driven reasoning with structured outputs, conversation context, and schema awareness.

Intent Categories:
  1. sql_analytics      — Querying, aggregating, filtering, or reporting from database tables
  2. document_qa        — Questions about uploaded PDFs/docs, summaries, methodology, citations
  3. hybrid             — Requires BOTH database data AND uploaded document content
  4. general_knowledge  — Conceptual / educational / architecture questions
  5. greeting           — Greetings, small talk, pleasantries
  6. schema_management  — Create / alter / design database tables using natural language
  7. data_modification  — Requests to INSERT / UPDATE / DELETE data in tables
  8. ambiguous          — Unclear, incomplete, or requires clarification
"""

import re
from typing import Dict, Any, List, Optional
from ..llm.provider import LLMProvider

VALID_INTENTS = {
    "sql_analytics",
    "document_qa",
    "hybrid",
    "general_knowledge",
    "greeting",
    "schema_management",
    "data_modification",
    "ambiguous",
}

# Fast pattern for trivial standalone greetings only (saves LLM tokens for simple "hi")
TRIVIAL_GREETING_PATTERN = re.compile(r"^\s*(hi|hello|hey|good\s+(morning|afternoon|evening)|thank\s+you|thanks)\s*[\.!]?\s*$", re.IGNORECASE)


class IntentRouter:
    """
    LLM-driven intent classifier with structured JSON outputs and conversation context.
    Falls back to heuristics only when no API key is configured.
    """

    def __init__(self, provider: Optional[LLMProvider] = None):
        self.provider = provider or LLMProvider()

    def classify(
        self,
        message: str,
        has_uploaded_docs: bool = False,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        schema_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Classifies user intent using LLM reasoning (primary) or deterministic fallback.
        """
        cleaned = message.strip()
        if not cleaned:
            return self._result("ambiguous", 0.99, "rule", "Empty message")

        # 1. Quick check for trivial single-word greetings to save LLM tokens
        if TRIVIAL_GREETING_PATTERN.match(cleaned):
            return self._result("greeting", 0.98, "pattern", "Standard greeting")

        # 2. Primary: LLM-Driven Dynamic Intent Classification with Context
        if self.provider and self.provider.has_active_api_key():
            try:
                return self._llm_classify(
                    message=cleaned,
                    has_uploaded_docs=has_uploaded_docs,
                    conversation_history=conversation_history,
                    schema_context=schema_context,
                )
            except Exception as e:
                # LLM classification failed; fall through to offline heuristic
                pass

        # 3. Offline Heuristic Fallback (only when no LLM key is configured or call fails)
        return self._heuristic_classify(cleaned, has_uploaded_docs, conversation_history)

    def _llm_classify(
        self,
        message: str,
        has_uploaded_docs: bool,
        conversation_history: Optional[List[Dict[str, str]]],
        schema_context: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Calls LLM to dynamically determine intent using structured JSON output.
        """
        history_summary = "None"
        if conversation_history:
            recent = conversation_history[-4:]
            history_summary = "\n".join(
                f"- {m.get('role', 'user').upper()}: {m.get('content', '')[:180]}"
                for m in recent if m.get("content")
            )

        tables_info = "None"
        if schema_context and "tables" in schema_context:
            table_names = list(schema_context["tables"].keys())
            if table_names:
                tables_info = ", ".join(table_names[:12])

        prompt = f"""You are the intent router for a Conversational SQL Analytics Assistant.
Analyze the user's message and select EXACTLY ONE category.

User Message: "{message}"

Context:
- Uploaded Documents Available: {has_uploaded_docs}
- Available Database Tables: {tables_info}
- Recent Conversation:
{history_summary}

Intent Categories:
1. "sql_analytics": Querying, calculating, filtering, comparing, ranking, or visualizing data from tables (e.g., "find employees earning more than dept average", "show sales by region", "show top 3", "which department performed best?").
2. "document_qa": Questions seeking information, definitions, methodology, summaries, citations, or analysis from uploaded documents or PDFs (e.g., "explain the methodology", "what are its limitations?", "summarize the uploaded report").
3. "hybrid": Questions explicitly requiring BOTH structured database tables AND document text to answer (e.g., "compare the findings in my PDF with the employee dataset").
4. "general_knowledge": Conceptual questions about SQL, data architecture, statistics, or technology not requiring private data (e.g., "how does a B-tree index work?", "difference between inner and left join").
5. "greeting": Greetings, small talk, appreciation, farewells (e.g., "hello", "how are you?", "thanks for the help").
6. "schema_management": Creating, altering, designing, or dropping database tables via DDL (e.g., "create a table for customers", "add column discount").
7. "data_modification": Inserting, updating, or deleting specific records in a table (e.g., "insert a new department named AI Lab", "update salary to 90000").
8. "ambiguous": The request is completely indecipherable or unclear.

CRITICAL INSTRUCTIONS:
- If the user asks a follow-up like "what are its limitations?" and the previous turns discussed a document/paper, classify as "document_qa".
- If the user asks a follow-up like "show only top three" and the previous turns discussed SQL data, classify as "sql_analytics".
- Do NOT classify document questions as "general_knowledge" if documents are uploaded.

Return ONLY a JSON object:
{{"intent": "<category>", "confidence": 0.95, "reasoning": "<one sentence explanation>"}}"""

        result = self.provider.generate_structured_json(prompt)
        intent = result.get("intent", "").strip().lower()
        if intent not in VALID_INTENTS:
            intent = "sql_analytics" if has_uploaded_docs is False else "document_qa"

        confidence = float(result.get("confidence", 0.85))
        reasoning = result.get("reasoning", "LLM classified intent")
        return self._result(intent, confidence, "llm", reasoning)

    def _heuristic_classify(
        self,
        message: str,
        has_uploaded_docs: bool,
        conversation_history: Optional[List[Dict[str, str]]],
    ) -> Dict[str, Any]:
        """Offline rule-based fallback when LLM is unavailable."""
        msg_lower = message.lower()

        # Schema management
        if any(w in msg_lower for w in ["create table", "alter table", "add column", "drop table", "make a table"]):
            return self._result("schema_management", 0.85, "heuristic", "Matches schema management pattern")

        # Data modification
        if any(w in msg_lower for w in ["insert into", "delete from", "update ", "add record"]):
            return self._result("data_modification", 0.85, "heuristic", "Matches data modification pattern")

        # Document signals
        doc_signals = any(w in msg_lower for w in [
            "document", "pdf", "paper", "methodology", "limitations", "section", "paragraph", "author", "findings"
        ])
        if has_uploaded_docs and doc_signals:
            return self._result("document_qa", 0.80, "heuristic", "Document question pattern with docs present")

        # General conceptual questions
        if any(w in msg_lower for w in ["what is a", "what are", "difference between", "how do indexes", "explain b-tree"]):
            return self._result("general_knowledge", 0.80, "heuristic", "Matches conceptual explanation pattern")

        # Default to SQL analytics
        return self._result("sql_analytics", 0.65, "heuristic", "Defaulted to analytics")

    @staticmethod
    def _result(intent: str, confidence: float, method: str, reasoning: str) -> Dict[str, Any]:
        return {
            "intent": intent,
            "confidence": round(confidence, 2),
            "method": method,
            "reasoning": reasoning,
        }
