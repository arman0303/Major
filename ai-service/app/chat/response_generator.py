"""
Response Generator — routes classified intents to the correct handler
and produces a unified ChatResponse object.

Handles:
  - sql_analytics         → SQLGenerator + execution
  - document_qa           → RAG retrieval + LLM answer
  - hybrid                → Both SQL + RAG combined
  - general_knowledge     → Direct LLM answer (DB/SQL concepts)
  - general_conversation  → General-purpose AI conversation (any topic)
  - programming_help      → Code writing, debugging, algorithms, interview prep
  - greeting              → Warm, brief response
  - schema_management     → SchemaCreator
  - data_modification     → SQL with confirmation required
  - ambiguous             → Clarification question
"""

import re
from typing import Dict, Any, List, Optional
from ..llm.provider import LLMProvider, classify_llm_error
from ..sql.generator import SQLGenerator
from ..sql.validator import SQLValidator
from ..schema.creator import SchemaCreator

SYSTEM_CHAT_PROMPT = """You are DataPilot, an intelligent AI assistant that helps users with a wide range of tasks.

Your capabilities include:
- General knowledge: science, history, technology, mathematics, writing, brainstorming
- AI & Machine Learning: concepts, architectures, comparisons, applications
- Programming & software engineering: code writing, debugging, algorithms, data structures, system design, interview prep
- Database analytics: SQL query generation, data analysis, schema design
- Document analysis: answering questions from uploaded PDFs and documents

Guidelines:
- Be concise, accurate, and direct. Avoid filler phrases like "Certainly!" or "Great question!".
- For code questions, always provide working code examples with explanations.
- For conceptual questions, give clear explanations with real-world examples.
- For SQL questions, explain results in plain language after showing the data.
- For document questions, cite the source (document name and page if known).
- Use conversation history to resolve follow-up questions like "explain it again", "give me an example", "what are its advantages?", "continue from where we stopped".
- When unsure, ask a focused clarification question.
- Use professional but friendly language.
- Never fabricate data or pretend to have executed a query you haven't.
- Never expose API keys or internal configuration details.
"""

PROGRAMMING_SYSTEM_PROMPT = """You are DataPilot, an expert software engineering AI assistant.

You help with:
- Writing, explaining, debugging, and optimizing code in any language (Python, Java, JavaScript, TypeScript, C++, Go, Rust, etc.)
- Algorithms and data structures (time/space complexity, implementations, comparisons)
- System design concepts and patterns (microservices, databases, caching, load balancing)
- Interview preparation (technical questions, solutions, step-by-step explanations)
- Software architecture and design patterns (MVC, SOLID, Observer, Factory, etc.)
- Framework and library explanations (React, Node.js, Django, Flask, Spring, etc.)
- Computer science fundamentals (OS, DBMS, Computer Networks, Compiler Design)
- Competitive programming and problem solving

Guidelines:
- Always provide working, well-commented code examples.
- Explain step by step. Use numbered lists for multi-step processes.
- For algorithms, explain the approach first, then show code, then discuss time and space complexity.
- For debugging, identify the bug clearly before showing the fix.
- For system design, cover components, scalability, and trade-offs.
- Use conversation history to build on previous explanations when user says "give me an example", "explain it again", "make it simpler", etc.
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
            return self._handle_greeting(message, conversation_history)

        elif intent == "general_conversation":
            return self._handle_general_conversation(message, conversation_history)

        elif intent == "programming_help":
            return self._handle_programming_help(message, conversation_history)

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

    def _handle_greeting(self, message: str, history: List[Dict[str, str]]) -> Dict[str, Any]:
        """Handle greetings naturally. Use LLM if available for personalized response."""
        if self.provider.has_active_api_key():
            try:
                context = self._format_history(history, max_turns=3)
                prompt = f"""The user sent a greeting or introductory message. Respond warmly and briefly.
Mention that you can help with: general knowledge, AI/ML concepts, programming, SQL analytics, and document analysis.

{f"Recent conversation:{chr(10)}{context}" if context else ""}
User: {message}

Keep your response to 2-3 sentences. Be friendly and welcoming."""
                answer = self.provider.generate_completion(prompt, system_prompt=SYSTEM_CHAT_PROMPT, temperature=0.5)
                return self._chat_response(answer, "greeting")
            except Exception:
                pass

        # Static fallback
        greetings = {
            "hello": "Hello! I'm DataPilot, your AI assistant. I can help with general knowledge, AI/ML concepts, programming, SQL analytics, and document analysis. What would you like to explore?",
            "hi": "Hi there! I'm DataPilot. Ask me anything — from programming questions and AI concepts to SQL queries and document analysis. What are you working on today?",
            "hey": "Hey! I'm DataPilot, your AI assistant. I can help with programming, AI concepts, database analytics, and much more. What do you need?",
            "thanks": "You're welcome! Feel free to ask if you have more questions — I'm here to help.",
            "thank you": "Happy to help! Let me know if there's anything else you'd like to know.",
            "good morning": "Good morning! I'm DataPilot, ready to assist with coding, AI concepts, SQL analytics, or anything else you need.",
            "good afternoon": "Good afternoon! What can I help you with today?",
            "good evening": "Good evening! Ask me anything — programming, AI, databases, or general knowledge.",
            "how are you": "I'm doing great and ready to help! What would you like to explore today?",
            "what can you do": (
                "I can help with a wide range of tasks:\n"
                "- **General knowledge**: science, history, writing, math\n"
                "- **AI & ML**: explain concepts, architectures, and use cases\n"
                "- **Programming**: write, debug, and explain code in any language\n"
                "- **SQL & Databases**: generate queries, analyze data, design schemas\n"
                "- **Document Analysis**: answer questions from uploaded PDFs\n\n"
                "What would you like to start with?"
            ),
        }

        msg_lower = message.lower().strip().rstrip("!.,")
        for key, response in greetings.items():
            if key in msg_lower:
                return self._chat_response(response, "greeting")

        return self._chat_response(
            "Hello! I'm DataPilot, your AI assistant. I can help with programming, AI/ML concepts, SQL analytics, document analysis, and much more. What would you like to explore?",
            "greeting"
        )

    def _handle_general_conversation(
        self, message: str, history: List[Dict[str, str]]
    ) -> Dict[str, Any]:
        """Handle general-purpose AI conversation on ANY topic."""
        if not self.provider.has_active_api_key():
            return self._no_llm_response()

        context = self._format_history(history, max_turns=10)
        prompt = f"""Answer the following question or request comprehensively and clearly.

{f"Conversation history:{chr(10)}{context}{chr(10)}" if context else ""}
User: {message}

Provide a thorough, accurate, and well-structured response. Use markdown formatting where appropriate (headings, bullet points, bold text). If this is a follow-up question, use the conversation history to understand context."""

        try:
            answer = self.provider.generate_completion(prompt, system_prompt=SYSTEM_CHAT_PROMPT, temperature=0.4)
            return self._chat_response(answer, "general_conversation", response_source="llm_conversation")
        except Exception as e:
            classified = classify_llm_error(e)
            return self._chat_response(
                f"⚠️ **AI Generation Notice**\n\n{classified['message']}\n\n"
                f"Please verify your AI credentials or model selection in Settings.",
                "general_conversation"
            )

    def _handle_programming_help(
        self, message: str, history: List[Dict[str, str]]
    ) -> Dict[str, Any]:
        """Handle programming, coding, algorithms, and interview prep questions."""
        if not self.provider.has_active_api_key():
            return self._no_llm_response()

        context = self._format_history(history, max_turns=10)
        prompt = f"""Provide expert programming help for the following question.

{f"Conversation history:{chr(10)}{context}{chr(10)}" if context else ""}
User: {message}

Guidelines:
- Provide working, well-commented code examples
- Explain the approach step by step
- For algorithms, include time and space complexity analysis
- For debugging, identify the specific issue and explain the fix
- Use the conversation history to resolve follow-up questions like "explain it again" or "give me an example"
- Format code blocks properly with the language name (e.g. ```java, ```python)"""

        try:
            answer = self.provider.generate_completion(prompt, system_prompt=PROGRAMMING_SYSTEM_PROMPT, temperature=0.3)
            return self._chat_response(answer, "programming_help", response_source="llm_conversation")
        except Exception as e:
            classified = classify_llm_error(e)
            return self._chat_response(
                f"⚠️ **Programming Assistant Notice**\n\n{classified['message']}\n\n"
                f"Please verify your AI credentials in Settings.",
                "programming_help"
            )

    def _handle_general_knowledge(
        self, message: str, history: List[Dict[str, str]]
    ) -> Dict[str, Any]:
        """Answer conceptual/educational questions about databases and SQL."""
        if not self.provider.has_active_api_key():
            return self._fallback_conceptual(message)

        context = self._format_history(history, max_turns=8)
        prompt = f"""Answer this database/SQL/data architecture question clearly and concisely.

{f"Recent conversation:{chr(10)}{context}" if context else ""}

Question: {message}

Provide a clear explanation with examples where helpful. Include SQL code snippets for SQL concepts."""

        try:
            answer = self.provider.generate_completion(prompt, system_prompt=SYSTEM_CHAT_PROMPT, temperature=0.3)
            return self._chat_response(answer, "general_knowledge", response_source="llm_conversation")
        except Exception:
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
                "response_source": "schema_generator",
                "document_sources": [],
            }
        except Exception:
            return self._chat_response(
                "I understand you want to create a schema. To help better, could you describe the tables and relationships you need? For example: 'Create a table for customers with name, email, and phone columns.'",
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
        result["response_source"] = "sql_generator"
        return result

    def _handle_document_qa(
        self,
        message: str,
        chunks: List[Dict[str, Any]],
        history: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        """Answer questions strictly grounded in retrieved document chunks with citations."""
        if not chunks:
            return self._chat_response(
                "I could not find relevant content in your uploaded documents for this question. "
                "Please ensure your document has been uploaded and indexed in this project, "
                "or try phrasing your inquiry around specific concepts from the text.",
                "document_qa"
            )

        formatted_sources = [
            {
                "document_name": c.get("metadata", {}).get("source", "Document"),
                "page_number": c.get("metadata", {}).get("page_number", 1),
                "similarity": c.get("similarity", 0.0),
                "chunk_id": c.get("id"),
                "content_preview": c.get("content", "")[:250] + "..." if len(c.get("content", "")) > 250 else c.get("content", "")
            }
            for c in chunks
        ]

        if not self.provider.has_active_api_key():
            content = "\n\n".join(
                f"**[{c.get('metadata', {}).get('source', 'Document')}, Page {c.get('metadata', {}).get('page_number', '?')}]**\n{c['content']}"
                for c in chunks[:4]
            )
            return self._chat_response(
                f"Here are the relevant verified excerpts from your uploaded document:\n\n{content}",
                "document_qa",
                sources=formatted_sources
            )

        context_parts = []
        for i, chunk in enumerate(chunks[:7], 1):
            meta = chunk.get("metadata", {})
            source = meta.get("source", "Document")
            page = meta.get("page_number", "")
            loc = f"{source}{f', Page {page}' if page else ''}"
            context_parts.append(f"--- EXCERPT {i} ({loc}) ---\n{chunk['content']}")

        context_text = "\n\n".join(context_parts)
        history_context = self._format_history(history, max_turns=6)

        prompt = f"""You are answering a question based strictly on the provided uploaded document excerpts.

DOCUMENT EXCERPTS:
{context_text}

{f"RECENT CONVERSATION CONTEXT:{chr(10)}{history_context}{chr(10)}" if history_context else ""}
USER QUESTION: {message}

STRICT GROUNDING & CITATION RULES:
1. Base your answer EXCLUSIVELY on facts directly stated in the excerpts above.
2. If the excerpts do not contain the answer, explicitly state: "Based on the uploaded document, I could not find information regarding that." DO NOT speculate or invent information.
3. For every major finding, claim, or summary point, cite the document name and page number (e.g., "[Research_Paper.pdf, Page 4]").
4. If this is a follow-up inquiry (e.g. "what are its limitations?", "explain its methodology"), resolve pronouns using the recent conversation context.
5. Present the response with clear formatting, using bullet points or sections where appropriate.

ANSWER:"""

        try:
            answer = self.provider.generate_completion(prompt, system_prompt=SYSTEM_CHAT_PROMPT, temperature=0.1)
            return self._chat_response(answer, "document_qa", sources=formatted_sources, response_source="document_rag")
        except Exception as e:
            return self._chat_response(
                f"I found relevant excerpts from your document, but encountered an error synthesizing the final response.\n\n"
                f"**Top Excerpt [{formatted_sources[0]['document_name']}, Page {formatted_sources[0]['page_number']}]:**\n"
                f"{chunks[0]['content'][:600]}...",
                "document_qa",
                sources=formatted_sources
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

        combined = f"{sql_result.get('answer', sql_result.get('explanation', ''))}\n\n"
        if doc_result.get("answer") and "don't see any relevant" not in doc_result["answer"]:
            combined += f"**From documents:**\n{doc_result['answer']}"

        sql_result["answer"] = combined.strip()
        sql_result["response_type"] = "hybrid"
        sql_result["document_sources"] = doc_result.get("sources", [])
        sql_result["response_source"] = "hybrid"
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
        result["response_source"] = "sql_generator"
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
            f"3. **Learn a concept** — get an explanation of a technical topic?\n"
            f"4. **Get programming help** — write or debug code?\n\n"
            f"Could you provide a bit more detail?",
            "ambiguous"
        )

    def synthesize_sql_answer(
        self,
        question: str,
        sql: str,
        rows: List[Dict[str, Any]],
        columns: List[str],
        row_count: int,
    ) -> str:
        """
        Synthesizes a fact-based natural language answer grounded strictly
        in the actual returned query rows.
        """
        if row_count == 0 or not rows:
            return "The query was executed successfully against your database, but returned 0 records matching your criteria."

        if self.provider.has_active_api_key():
            prompt = f"""You are DataPilot, a senior data analyst.
A user asked this question:
"{question}"

The following SQL query was executed:
```sql
{sql}
```

Database Result Summary:
Total Rows Returned: {row_count}
Columns: {', '.join(columns)}
First Rows (up to 25):
{rows[:25]}

Task:
Write a clear, concise, and fact-based summary answer for the user based strictly on the actual returned data rows above.
Rules:
1. Ground your answer completely in the returned data. Never invent or assume numbers that are not in the rows.
2. If the query computed an aggregation (SUM, AVG, MIN, MAX, COUNT), clearly state the exact calculated number.
3. If the query ranked or listed entities, identify the key entities and their exact values.
4. Do NOT explain SQL syntax or state "This query selects...". Answer the user's business question directly.
5. Keep your tone professional, crisp, and informative.
"""
            try:
                synth = self.provider.generate_completion(prompt, system_prompt=SYSTEM_CHAT_PROMPT, temperature=0.1)
                if synth and synth.strip():
                    return synth.strip()
            except Exception:
                pass

        # Deterministic fallback when offline
        if row_count == 1:
            row = rows[0]
            summary_parts = [f"**{k}**: {v}" for k, v in row.items()]
            return f"Query returned 1 record: {', '.join(summary_parts)}."
        else:
            first_col = columns[0] if columns else "record"
            second_col = columns[1] if len(columns) > 1 else None
            samples = []
            for r in rows[:3]:
                if second_col and second_col in r:
                    samples.append(f"{r.get(first_col)} ({r.get(second_col)})")
                else:
                    samples.append(str(r.get(first_col)))
            sample_str = ", ".join(samples)
            more_str = f" and {row_count - len(samples)} more" if row_count > len(samples) else ""
            return f"Found {row_count} records. Top entries: {sample_str}{more_str}."

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _no_llm_response(self) -> Dict[str, Any]:
        """Return a clear, honest message when no LLM API key is configured."""
        return self._chat_response(
            "⚠️ **AI Provider Not Configured**\n\n"
            "To answer general questions, programming questions, and AI/ML concepts, "
            "DataPilot needs a Gemini or OpenAI API key.\n\n"
            "**To configure your API key:**\n"
            "1. Go to **Settings** (gear icon)\n"
            "2. Enter your Gemini API key (free at https://ai.google.dev/)\n"
            "3. Select your preferred model\n"
            "4. Save settings\n\n"
            "Once configured, I can answer any general question, help with programming, "
            "explain AI/ML concepts, and much more.\n\n"
            "**Without an API key**, I can still:\n"
            "- Execute SQL queries on your uploaded datasets\n"
            "- Show data analytics results\n"
            "- Answer basic database concept questions",
            "general_conversation"
        )

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

        return self._no_llm_response()

    @staticmethod
    def _format_history(history: List[Dict[str, str]], max_turns: int = 10) -> str:
        """Format last N conversation turns as text context."""
        if not history:
            return ""
        recent = history[-max_turns * 2:]
        lines = []
        for msg in recent:
            role = msg.get("role", "user").capitalize()
            content = msg.get("content", "")[:400]
            lines.append(f"{role}: {content}")
        return "\n".join(lines)

    @staticmethod
    def _chat_response(
        answer: str,
        response_type: str,
        sources: Optional[List[Dict]] = None,
        response_source: Optional[str] = None,
    ) -> Dict[str, Any]:
        return {
            "response_type": response_type,
            "answer": answer,
            "generated_sql": None,
            "query_type": None,
            "requires_confirmation": False,
            "document_sources": sources or [],
            "response_source": response_source or response_type,
        }
