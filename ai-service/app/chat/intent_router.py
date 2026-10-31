"""
Intent Router — classifies user input into one of 8 intent categories
and routes to the appropriate handler.

Intent Categories:
  1. sql_analytics      — Database questions, analytics, reporting
  2. document_qa        — Questions about uploaded PDFs/docs
  3. hybrid             — Requires both DB data and document content
  4. general_knowledge  — Conceptual / educational questions
  5. greeting           — Greetings, small talk
  6. schema_management  — Create/alter DB tables using natural language
  7. data_modification  — INSERT/UPDATE/DELETE requests
  8. ambiguous          — Unclear; needs clarification
"""

import re
from typing import Dict, Any, List, Optional, Tuple
from ..llm.provider import LLMProvider

# ── Keywords that strongly indicate SQL / analytics intent ──────────────────
SQL_KEYWORDS = {
    "show", "find", "list", "get", "fetch", "display", "give me",
    "count", "sum", "total", "average", "avg", "max", "min",
    "how many", "how much", "which", "who", "top", "bottom",
    "rank", "compare", "trend", "group", "aggregate",
    "employee", "employees", "department", "departments",
    "salary", "salaries", "project", "projects", "sales",
    "revenue", "orders", "customer", "customers", "region",
    "hire", "hired", "joining", "performance",
    "join", "inner join", "left join", "where", "having",
    "select", "query", "database", "table", "row", "record",
    "more than", "less than", "greater", "between", "filter",
}

# ── Keywords for document / PDF questions ────────────────────────────────────
DOC_KEYWORDS = {
    "document", "pdf", "file", "uploaded", "paper", "report",
    "article", "text", "page", "paragraph", "section", "chapter",
    "summarize", "summary", "explain the", "according to", "in the document",
    "the paper", "the report", "the article", "the file", "mentions",
    "states", "says", "referenced", "cited",
}

# ── Keywords for schema management ───────────────────────────────────────────
SCHEMA_KEYWORDS = {
    "create table", "create a table", "create database", "alter table",
    "add column", "drop column", "new table", "make a table",
    "design schema", "design a schema", "build schema",
    "schema for", "define a table", "set up a table",
}

# ── Keywords for data modification ───────────────────────────────────────────
MUTATION_KEYWORDS = {
    "insert", "add a record", "add new", "update", "delete", "remove",
    "change the value", "modify", "set salary", "set the", "drop table",
    "truncate", "bulk insert",
}

# ── Greeting / small talk ─────────────────────────────────────────────────────
GREETING_PATTERNS = [
    r"^\s*(hi|hello|hey|good (morning|afternoon|evening)|howdy|sup)\b",
    r"^\s*how are you",
    r"^\s*what('?s| is) your name",
    r"^\s*who are you",
    r"^\s*thanks?\.?\s*$",
    r"^\s*thank you\.?\s*$",
]

# ── Conceptual / general knowledge ──────────────────────────────────────────
CONCEPTUAL_KEYWORDS = {
    "what is", "what are", "explain", "describe", "how does",
    "why does", "difference between", "definition of",
    "how do", "what does", "tell me about", "can you explain",
    "what's the difference", "when should", "pros and cons",
}


class IntentRouter:
    """
    Classifies user messages and routes them to the correct handler.
    Uses a fast keyword-based pre-classifier first, then optionally
    calls the LLM for ambiguous cases when an API key is available.
    """

    def __init__(self, provider: Optional[LLMProvider] = None):
        self.provider = provider

    def classify(
        self,
        message: str,
        has_uploaded_docs: bool = False,
        conversation_history: Optional[List[Dict]] = None,
    ) -> Dict[str, Any]:
        """
        Returns:
        {
          "intent": "sql_analytics" | "document_qa" | "hybrid" |
                    "general_knowledge" | "greeting" | "schema_management" |
                    "data_modification" | "ambiguous",
          "confidence": 0.0–1.0,
          "method": "keyword" | "llm",
          "reasoning": "brief explanation"
        }
        """
        msg_lower = message.lower().strip()

        # 1. Greeting check (fastest)
        for pattern in GREETING_PATTERNS:
            if re.search(pattern, msg_lower):
                return self._result("greeting", 0.95, "keyword", "Matches greeting pattern")

        # 2. Schema management
        if any(kw in msg_lower for kw in SCHEMA_KEYWORDS):
            return self._result("schema_management", 0.90, "keyword", "Contains schema creation keyword")

        # 3. Data modification
        if any(kw in msg_lower for kw in MUTATION_KEYWORDS):
            return self._result("data_modification", 0.88, "keyword", "Contains data mutation keyword")

        # 4. Score SQL vs Document vs Conceptual
        sql_score = sum(1 for kw in SQL_KEYWORDS if kw in msg_lower)
        doc_score = sum(1 for kw in DOC_KEYWORDS if kw in msg_lower)
        concept_score = sum(1 for kw in CONCEPTUAL_KEYWORDS if kw in msg_lower)

        # Bonus: if user has uploaded docs and asks about them
        if has_uploaded_docs and doc_score > 0:
            doc_score += 2

        # Hybrid: both doc and SQL signals
        if doc_score >= 2 and sql_score >= 2:
            return self._result("hybrid", 0.75, "keyword", f"Mixed signals: sql={sql_score}, doc={doc_score}")

        if doc_score >= 2:
            return self._result("document_qa", 0.80, "keyword", f"Document question signals (score={doc_score})")

        if sql_score >= 2:
            return self._result("sql_analytics", 0.82, "keyword", f"SQL analytics signals (score={sql_score})")

        # Conceptual question — no DB/doc keywords, but has explanatory intent
        if concept_score >= 1 and sql_score <= 1 and doc_score == 0:
            # Still might be a database conceptual question
            db_concept = any(
                kw in msg_lower
                for kw in ["sql", "join", "index", "query", "database", "table", "key", "schema"]
            )
            return self._result(
                "general_knowledge", 0.78, "keyword",
                f"Conceptual question {'about DB concepts' if db_concept else ''}"
            )

        # 5. LLM classification for ambiguous cases (if API key available)
        if self.provider and self.provider.has_active_api_key():
            return self._llm_classify(message, has_uploaded_docs, conversation_history)

        # 6. Default fallback: try SQL if there's any database-like word
        if sql_score >= 1:
            return self._result("sql_analytics", 0.55, "keyword", "Weak SQL signal, defaulting to analytics")

        return self._result("ambiguous", 0.40, "keyword", "Unable to determine intent clearly")

    def _llm_classify(
        self,
        message: str,
        has_uploaded_docs: bool,
        conversation_history: Optional[List[Dict]],
    ) -> Dict[str, Any]:
        """Use LLM to classify genuinely ambiguous messages."""
        history_summary = ""
        if conversation_history:
            recent = conversation_history[-4:]
            history_summary = "\n".join(
                f"{m.get('role', 'user').upper()}: {m.get('content', '')[:200]}"
                for m in recent
            )

        prompt = f"""Classify this user message into exactly one intent category.

Message: "{message}"

Recent Conversation:
{history_summary or "None"}

Has Uploaded Documents: {has_uploaded_docs}

Categories:
- sql_analytics: User wants to query/analyze data from a database
- document_qa: User wants information from an uploaded PDF/document
- hybrid: User needs both database data AND document content
- general_knowledge: Conceptual/educational question, no specific data needed
- greeting: Greetings, thanks, small talk
- schema_management: User wants to create/modify database tables
- data_modification: User wants to INSERT/UPDATE/DELETE data
- ambiguous: Genuinely unclear, needs clarification

Return JSON only:
{{"intent": "...", "confidence": 0.85, "reasoning": "one sentence"}}"""

        try:
            result = self.provider.generate_structured_json(prompt)
            intent = result.get("intent", "ambiguous")
            # Validate intent is one of the known categories
            valid = {
                "sql_analytics", "document_qa", "hybrid", "general_knowledge",
                "greeting", "schema_management", "data_modification", "ambiguous"
            }
            if intent not in valid:
                intent = "ambiguous"
            return self._result(
                intent,
                float(result.get("confidence", 0.70)),
                "llm",
                result.get("reasoning", "LLM classified")
            )
        except Exception:
            return self._result("sql_analytics", 0.50, "keyword", "LLM classification failed, defaulting")

    @staticmethod
    def _result(intent: str, confidence: float, method: str, reasoning: str) -> Dict[str, Any]:
        return {
            "intent": intent,
            "confidence": confidence,
            "method": method,
            "reasoning": reasoning,
        }
