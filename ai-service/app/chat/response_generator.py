"""
Response Generator — routes classified intents to the correct handler
and produces a unified ChatResponse object.

Handles:
  - sql_analytics      → SQLGenerator + execution
  - document_qa        → RAG retrieval + LLM answer
  - hybrid             → Both SQL + RAG combined
  - general_knowledge  → Direct LLM answer (no SQL)
  - greeting           → Warm, brief response
  - schema_management  → SchemaCreator
  - data_modification  → SQL with confirmation required
  - ambiguous          → Clarification question
"""

import re
from typing import Dict, Any, List, Optional
from ..llm.provider import LLMProvider
from ..sql.generator import SQLGenerator
from ..sql.validator import SQLValidator
from ..schema.creator import SchemaCreator

SYSTEM_CHAT_PROMPT = """You are a professional AI data analyst assistant named DataPilot.
You help users understand their data, answer questions from documents, and generate SQL queries.

Guidelines:
- Be concise and direct. Avoid filler phrases like "Certainly!" or "Great question!".
- For SQL questions, explain results in plain language after showing the data.
- For conceptual questions, give clear explanations with examples.
- For document questions, cite the source (document name and page if known).
- When unsure, ask a focused clarification question.
- Use professional but friendly language.
- Never fabricate data or pretend to have executed a query you haven't.
"""


class ResponseGenerator:
    """
    Unified response generator that routes to the correct handler
    based on classified intent.
    """

    def __init__(self, provider: Optional[LLMProvider] = None):
        self.provider = provider or LLMProvider()
        self.sql_generator = SQLGenerator(provider=self.provider)
        self.schema_creator = SchemaCreator(provider=self.provider)

    def generate(
        self,
        intent: str,
        message: str,
        schema_context: Dict[str, Any],
        conversation_history: List[Dict[str, str]],
        document_chunks: Optional[List[Dict[str, Any]]] = None,
        previous_sql: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Main dispatch method.
        Returns a unified response dict.
        """
        if intent == "greeting":
            return self._handle_greeting(message)

        elif intent == "general_knowledge":
            return self._handle_general_knowledge(message, conversation_history)

        elif intent == "schema_management":
            return self._handle_schema_management(message)

        elif intent == "data_modification":
            return self._handle_data_modification(message, schema_context, conversation_history, previous_sql)

        elif intent == "document_qa":
            return self._handle_document_qa(message, document_chunks or [], conversation_history)

        elif intent == "hybrid":
            return self._handle_hybrid(message, schema_context, document_chunks or [], conversation_history, previous_sql)

        elif intent == "sql_analytics":
            return self._handle_sql_analytics(message, schema_context, conversation_history, previous_sql)

        else:  # ambiguous
            return self._handle_ambiguous(message, schema_context, conversation_history)

    # ── Handlers ─────────────────────────────────────────────────────────────

    def _handle_greeting(self, message: str) -> Dict[str, Any]:
        """Handle greetings naturally without SQL."""
        greetings = {
            "hello": "Hello! I'm your AI data analyst. You can ask me to query your database, analyze uploaded documents, or explain database concepts. What would you like to explore?",
            "hi": "Hi there! Ready to help you with data analysis and SQL. What are you working on today?",
            "hey": "Hey! Ask me anything about your data — SQL queries, document analysis, or database concepts.",
            "thanks": "You're welcome! Let me know if you have more questions.",
            "thank you": "Happy to help! Feel free to ask more questions.",
            "good morning": "Good morning! Ready to dive into your data analysis whenever you are.",
            "good afternoon": "Good afternoon! What data questions can I help with?",
            "good evening": "Good evening! Let me know what you'd like to analyze.",
        }

        msg_lower = message.lower().strip().rstrip("!.,")
        for key, response in greetings.items():
            if key in msg_lower:
                return self._chat_response(response, "greeting")

        # Generic greeting
        return self._chat_response(
            "Hello! I'm your AI data analyst. I can help you query databases, analyze uploaded documents, and explain SQL concepts. What would you like to explore?",
            "greeting"
        )

    def _handle_general_knowledge(
        self, message: str, history: List[Dict[str, str]]
    ) -> Dict[str, Any]:
        """Answer conceptual/educational questions without SQL."""
        if not self.provider.has_active_api_key():
            return self._fallback_conceptual(message)

        context = self._format_history(history, max_turns=6)
        prompt = f"""Answer this question clearly and concisely. Focus on accuracy and clarity.

{f"Recent conversation:{chr(10)}{context}" if context else ""}

Question: {message}

Provide a clear explanation. If it's about SQL or databases, include a brief example."""

        try:
            answer = self.provider.generate_completion(prompt, system_prompt=SYSTEM_CHAT_PROMPT, temperature=0.3)
            return self._chat_response(answer, "general_knowledge")
        except Exception as e:
            return self._fallback_conceptual(message)

    def _handle_schema_management(self, message: str) -> Dict[str, Any]:
        """Handle natural language schema creation requests."""
        try:
            result = self.schema_creator.generate_schema_from_prompt(message)
            return {
                "response_type": "schema_management",
                "answer": result.get("explanation", "Schema generated. Please review the DDL below."),
                "ddl_statements": result.get("ddl_statements", []),
                "tables": result.get("tables", []),
                "requires_confirmation": True,
                "generated_sql": "\n\n".join(result.get("ddl_statements", [])),
                "query_type": "CREATE",
            }
        except Exception as e:
            return self._chat_response(
                f"I understand you want to create a schema. To help better, could you describe the tables and relationships you need? For example: 'Create a table for customers with name, email, and phone columns.'",
                "schema_management"
            )

    def _handle_data_modification(
        self,
        message: str,
        schema_context: Dict[str, Any],
        history: List[Dict[str, str]],
        previous_sql: Optional[str],
    ) -> Dict[str, Any]:
        """Generate DML SQL but always require confirmation."""
        result = self.sql_generator.generate_sql(
            question=message,
            schema_context=schema_context,
            conversation_history=history,
            previous_sql=previous_sql,
        )
        result["requires_confirmation"] = True
        result["response_type"] = "data_modification"
        result["answer"] = (
            f"I've generated a **{result.get('query_type', 'modification')} query** for your request. "
            f"Please review the SQL carefully before confirming execution.\n\n"
            f"{result.get('explanation', '')}"
        )
        return result

    def _handle_document_qa(
        self,
        message: str,
        chunks: List[Dict[str, Any]],
        history: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        """Answer questions grounded in retrieved document chunks."""
        if not chunks:
            return self._chat_response(
                "I don't see any relevant content in your uploaded documents for this question. "
                "Please make sure you've uploaded and processed a document in this project, "
                "or try rephrasing your question.",
                "document_qa"
            )

        if not self.provider.has_active_api_key():
            # Show chunk content without LLM synthesis
            content = "\n\n".join(
                f"**[{c.get('metadata', {}).get('source', 'Document')}, "
                f"p.{c.get('metadata', {}).get('page_number', '?')}]**\n{c['content']}"
                for c in chunks[:3]
            )
            return self._chat_response(
                f"Here are the most relevant excerpts from your documents:\n\n{content}",
                "document_qa",
                sources=chunks
            )

        # Build context from chunks
        context_parts = []
        for i, chunk in enumerate(chunks[:6], 1):
            meta = chunk.get("metadata", {})
            source = meta.get("source", "Document")
            page = meta.get("page_number", "")
            loc = f"{source}{f', page {page}' if page else ''}"
            context_parts.append(f"[Excerpt {i} — {loc}]\n{chunk['content']}")

        context_text = "\n\n---\n\n".join(context_parts)
        history_context = self._format_history(history, max_turns=4)

        prompt = f"""Answer the user's question using ONLY the document excerpts provided below.
If the answer is not in the excerpts, say so clearly — do not fabricate.
Always cite the source document and page number when referencing specific information.

Document Excerpts:
{context_text}

{f"Recent conversation:{chr(10)}{history_context}" if history_context else ""}

Question: {message}

Answer (cite sources inline, e.g., [Document Name, page 3]):"""

        try:
            answer = self.provider.generate_completion(prompt, system_prompt=SYSTEM_CHAT_PROMPT, temperature=0.2)
            return self._chat_response(answer, "document_qa", sources=chunks)
        except Exception as e:
            return self._chat_response(
                f"Found relevant content but couldn't synthesize an answer: {str(e)}. "
                f"Here are the relevant excerpts: {context_parts[0][:500] if context_parts else ''}",
                "document_qa",
                sources=chunks
            )

    def _handle_hybrid(
        self,
        message: str,
        schema_context: Dict[str, Any],
        chunks: List[Dict[str, Any]],
        history: List[Dict[str, str]],
        previous_sql: Optional[str],
    ) -> Dict[str, Any]:
        """Handle questions requiring both DB data and document content."""
        sql_result = self._handle_sql_analytics(message, schema_context, history, previous_sql)
        doc_result = self._handle_document_qa(message, chunks, history)

        # Combine answers
        combined = f"{sql_result.get('answer', sql_result.get('explanation', ''))}\n\n"
        if doc_result.get("answer") and "don't see any relevant" not in doc_result["answer"]:
            combined += f"**From documents:**\n{doc_result['answer']}"

        sql_result["answer"] = combined.strip()
        sql_result["response_type"] = "hybrid"
        sql_result["document_sources"] = doc_result.get("sources", [])
        return sql_result

    def _handle_sql_analytics(
        self,
        message: str,
        schema_context: Dict[str, Any],
        history: List[Dict[str, str]],
        previous_sql: Optional[str],
    ) -> Dict[str, Any]:
        """Generate and return SQL for analytics queries."""
        result = self.sql_generator.generate_sql(
            question=message,
            schema_context=schema_context,
            conversation_history=history,
            previous_sql=previous_sql,
        )
        result["response_type"] = "sql_analytics"
        result["answer"] = result.get("explanation", "Query generated.")
        return result

    def _handle_ambiguous(
        self,
        message: str,
        schema_context: Dict[str, Any],
        history: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        """Request clarification for unclear questions."""
        tables = list(schema_context.get("tables", {}).keys())
        table_hint = f" (Available tables: {', '.join(tables[:5])})" if tables else ""

        if self.provider.has_active_api_key():
            prompt = f"""The user sent a message that's unclear. Ask one focused clarification question.
Available data tables: {', '.join(tables[:8]) if tables else 'None specified'}
User message: "{message}"
Ask a single, helpful clarification question."""
            try:
                clarification = self.provider.generate_completion(
                    prompt, system_prompt=SYSTEM_CHAT_PROMPT, temperature=0.4
                )
                return self._chat_response(clarification, "ambiguous")
            except Exception:
                pass

        return self._chat_response(
            f"I want to make sure I understand your request correctly{table_hint}. "
            f"Are you looking to:\n"
            f"1. **Query the database** — run SQL analytics on your data?\n"
            f"2. **Search a document** — find information in an uploaded file?\n"
            f"3. **Learn a concept** — get an explanation of a technical topic?\n\n"
            f"Could you provide a bit more detail?",
            "ambiguous"
        )

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _fallback_conceptual(self, message: str) -> Dict[str, Any]:
        """Answer common DB concepts without an LLM API key."""
        known = {
            "inner join": "An **INNER JOIN** returns only rows where there is a matching value in both tables. Rows without a match in either table are excluded.",
            "left join": "A **LEFT JOIN** returns all rows from the left table and matching rows from the right table. If no match exists, NULL values appear for right-table columns.",
            "right join": "A **RIGHT JOIN** returns all rows from the right table and matching rows from the left table.",
            "full outer join": "A **FULL OUTER JOIN** returns all rows from both tables, with NULLs where there is no match.",
            "index": "A database **index** is a data structure that speeds up data retrieval. It works like a book's index — instead of scanning every row, the database jumps directly to the relevant rows.",
            "primary key": "A **primary key** is a column (or set of columns) that uniquely identifies each row in a table. It cannot be NULL and must be unique.",
            "foreign key": "A **foreign key** is a column that references the primary key of another table, establishing a relationship between the two tables.",
            "cte": "A **Common Table Expression (CTE)** is a temporary, named result set defined with the WITH clause. It improves query readability and can be referenced multiple times.",
            "window function": "**Window functions** perform calculations across a set of rows related to the current row. Examples: ROW_NUMBER(), RANK(), SUM() OVER (PARTITION BY ...).",
            "subquery": "A **subquery** is a query nested inside another query. It can appear in SELECT, FROM, or WHERE clauses.",
        }
        msg_lower = message.lower()
        for keyword, explanation in known.items():
            if keyword in msg_lower:
                return self._chat_response(explanation, "general_knowledge")

        return self._chat_response(
            "That's a great question! To give you the most accurate answer, please configure a Gemini or OpenAI API key in Settings. "
            "In the meantime, I can answer database analytics questions using your actual data.",
            "general_knowledge"
        )

    @staticmethod
    def _format_history(history: List[Dict[str, str]], max_turns: int = 6) -> str:
        """Format last N conversation turns as text context."""
        if not history:
            return ""
        recent = history[-max_turns * 2:]
        lines = []
        for msg in recent:
            role = msg.get("role", "user").capitalize()
            content = msg.get("content", "")[:300]
            lines.append(f"{role}: {content}")
        return "\n".join(lines)

    @staticmethod
    def _chat_response(
        answer: str,
        response_type: str,
        sources: Optional[List[Dict]] = None,
    ) -> Dict[str, Any]:
        return {
            "response_type": response_type,
            "answer": answer,
            "generated_sql": None,
            "query_type": None,
            "requires_confirmation": False,
            "document_sources": sources or [],
        }
