"""
Intent Router — dynamically classifies user input into one of 10 intent categories
using LLM-driven reasoning with structured outputs, conversation context, and schema awareness.

Intent Categories:
  1. sql_analytics         — Querying, aggregating, filtering, or reporting from database tables
  2. document_qa           — Questions about uploaded PDFs/docs, summaries, methodology, citations
  3. hybrid                — Requires BOTH database data AND uploaded document content
  4. general_knowledge     — Conceptual / educational DB/SQL questions
  5. general_conversation  — General AI assistance: writing, brainstorming, science, AI/ML, etc.
  6. programming_help      — Code writing, debugging, algorithms, data structures, interview prep
  7. greeting              — Greetings, small talk, pleasantries
  8. schema_management     — Create / alter / design database tables using natural language
  9. data_modification     — Requests to INSERT / UPDATE / DELETE data in tables
  10. ambiguous            — Unclear, incomplete, or requires clarification
"""

import re
from typing import Dict, Any, List, Optional
from ..llm.provider import LLMProvider

VALID_INTENTS = {
    "sql_analytics",
    "document_qa",
    "hybrid",
    "general_knowledge",
    "general_conversation",
    "programming_help",
    "greeting",
    "schema_management",
    "data_modification",
    "ambiguous",
}

# Fast pattern for trivial standalone greetings (saves LLM tokens)
TRIVIAL_GREETING_PATTERN = re.compile(
    r"^\s*(hi|hello|hey|good\s+(morning|afternoon|evening)|thank\s+you|thanks|"
    r"how\s+are\s+you|what\s+can\s+you\s+do)\s*[\.!]?\s*$",
    re.IGNORECASE,
)

# Programming / technical help signals
PROGRAMMING_SIGNALS = re.compile(
    r"\b(write\s+(a|an|me)?\s*(program|code|function|class|script|algorithm)|"
    r"debug|fix\s+(this|the|my)\s+(code|error|bug)|explain\s+(this\s+)?(code|function|algorithm)|"
    r"implement|refactor|optimize\s+(this\s+)?code|"
    r"what\s+is\s+(a\s+)?(heap|stack|queue|tree|graph|array|linked\s+list)|"
    r"data\s+structure|time\s+complexity|big\s+o|recursion|sorting\s+algorithm|binary\s+search|"
    r"interview\s+(question|prep|practice)|system\s+design|design\s+pattern|rest\s+api|"
    r"object.oriented|inheritance|polymorphism|encapsulation|abstraction|"
    r"how\s+does\s+(react|node|python|java|javascript|typescript|django|flask|express|spring)\s+(work|handle)|"
    r"explain\s+(react|node\.?js|python|java|javascript|typescript|c\+\+|rust|go|kotlin|swift))\b",
    re.IGNORECASE,
)

# General conversation signals (not SQL, not programming, not documents)
GENERAL_CONV_SIGNALS = re.compile(
    r"\b(explain\s+(artificial\s+intelligence|machine\s+learning|deep\s+learning|neural\s+network|"
    r"natural\s+language\s+processing|computer\s+vision|reinforcement\s+learning)|"
    r"what\s+is\s+(ai|ml|nlp|gpt|llm|transformer|attention\s+mechanism)|"
    r"help\s+me\s+(write|draft|improve|summarize|brainstorm|plan)|"
    r"summarize\s+this|write\s+(an?\s+)?(essay|email|letter|report|summary)|"
    r"what\s+are\s+the\s+(advantages|disadvantages|pros|cons|benefits|drawbacks)|"
    r"operating\s+system|computer\s+network|"
    r"difference\s+between\s+(ai\s+and|ml\s+and|deep\s+learning))\b",
    re.IGNORECASE,
)


class IntentRouter:
    """
    LLM-driven intent classifier with structured JSON outputs and conversation context.
    Falls back to heuristics only when no API key is configured or LLM call fails.
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
            except Exception:
                # LLM classification failed; fall through to offline heuristic
                pass

        # 3. Offline Heuristic Fallback
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
            recent = conversation_history[-6:]
            history_summary = "\n".join(
                f"- {m.get('role', 'user').upper()}: {m.get('content', '')[:200]}"
                for m in recent if m.get("content")
            )

        tables_info = "None"
        if schema_context and "tables" in schema_context:
            table_names = list(schema_context["tables"].keys())
            if table_names:
                tables_info = ", ".join(table_names[:12])

        prompt = f"""You are the intent router for DataPilot, a general-purpose AI assistant that also specializes in SQL analytics and document analysis.
Analyze the user's message and select EXACTLY ONE category.

User Message: "{message}"

Context:
- Uploaded Documents Available: {has_uploaded_docs}
- Available Database Tables: {tables_info}
- Recent Conversation:
{history_summary}

Intent Categories:
1. "sql_analytics": The user explicitly wants to query, calculate, filter, compare, rank, or visualize data FROM specific database tables (e.g., "find employees earning more than dept average", "show sales by region", "which department performed best?"). ONLY use this when the user clearly wants to extract data from a database.
2. "document_qa": Questions seeking information, definitions, methodology, summaries, citations, or analysis FROM uploaded documents or PDFs (e.g., "explain the methodology", "what are its limitations?", "summarize the uploaded report").
3. "hybrid": Questions explicitly requiring BOTH structured database tables AND document text.
4. "general_knowledge": Conceptual questions specifically about SQL syntax, data architecture, normalization, indexing, or database-specific technology (e.g., "how does a B-tree index work?", "difference between inner and left join", "what is normalization?").
5. "general_conversation": General knowledge on any topic NOT requiring a database or document — science, history, writing, AI/ML concepts at a high level, brainstorming, current events (e.g., "explain artificial intelligence", "help me write an email", "what is machine learning?", "what are the pros and cons of X?").
6. "programming_help": Code writing, debugging, algorithm explanation, data structures, interview preparation, system design, software engineering concepts (e.g., "write a Java program", "explain recursion", "what is a heap?", "help me debug this code", "explain REST APIs", "what is time complexity?").
7. "greeting": Greetings, small talk, appreciation, farewells, or asking what the AI can do.
8. "schema_management": Creating, altering, designing, or dropping database tables via DDL.
9. "data_modification": Inserting, updating, or deleting specific records in a table.
10. "ambiguous": The request is completely indecipherable or unclear.

CRITICAL DISAMBIGUATION RULES:
- "Explain artificial intelligence", "what is machine learning?", "explain deep learning" → "general_conversation" NOT sql_analytics
- "Write a Python program", "explain recursion", "what is a heap?", "help me prepare for interviews" → "programming_help" NOT sql_analytics
- "What is a JOIN?", "explain window functions", "what is normalization?" → "general_knowledge"
- "Show me sales data", "find top employees by salary" → "sql_analytics" ONLY when querying actual data
- Questions containing words like "data", "table", "query", or "explain" are NOT automatically sql_analytics
- If previous turns were about a general topic and the user says "explain it again" or "give me an example", classify based on that topic
- If no documents are uploaded and no schema tables are available, prefer "general_conversation" over "sql_analytics"

Return ONLY a JSON object:
{{"intent": "<category>", "confidence": 0.95, "reasoning": "<one sentence explanation>"}}"""

        result = self.provider.generate_structured_json(prompt)
        intent = result.get("intent", "").strip().lower()
        if intent not in VALID_INTENTS:
            # Safe fallback: unknown intent → general_conversation
            intent = "general_conversation"

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

        # Programming help signals
        if PROGRAMMING_SIGNALS.search(message):
            return self._result("programming_help", 0.80, "heuristic", "Matches programming/coding pattern")

        # General conversation signals (AI, ML, writing, etc.)
        if GENERAL_CONV_SIGNALS.search(message):
            return self._result("general_conversation", 0.78, "heuristic", "Matches general knowledge/AI topic pattern")

        # SQL-specific conceptual questions
        if any(w in msg_lower for w in [
            "what is a join", "what are joins", "difference between", "how do indexes",
            "explain b-tree", "what is normalization", "what is a foreign key", "what is a primary key"
        ]):
            return self._result("general_knowledge", 0.80, "heuristic", "Matches DB concept explanation pattern")

        # Explicit SQL analytics signals
        sql_signals = any(w in msg_lower for w in [
            "select", "from my", "in my database", "show me the data", "find all", "count of",
            "total sales", "average salary", "top 5", "highest paid", "lowest rated",
            "group by", "order by", "filter by"
        ])
        if sql_signals:
            return self._result("sql_analytics", 0.75, "heuristic", "Matches SQL query pattern")

        # Default: general_conversation (NOT sql_analytics) when no signals match
        return self._result("general_conversation", 0.60, "heuristic", "No specific signal matched; defaulting to general conversation")

    @staticmethod
    def _result(intent: str, confidence: float, method: str, reasoning: str) -> Dict[str, Any]:
        return {
            "intent": intent,
            "confidence": round(confidence, 2),
            "method": method,
            "reasoning": reasoning,
        }
