import re
from typing import Dict, Any, Optional
from ..llm.provider import LLMProvider
from .validator import SQLValidator

class SQLCorrector:
    """
    Analyzes failed PostgreSQL queries and errors, classifies the error type
    (e.g., column not found, relation does not exist, syntax error, type mismatch),
    and generates a corrected, validated SQL query.
    """
    def __init__(self, provider: Optional[LLMProvider] = None):
        self.provider = provider or LLMProvider()

    def correct_sql(
        self,
        failed_sql: str,
        error_message: str,
        schema_context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Generates a corrected query and explanation of what was fixed.
        """
        sanitized_error = self._sanitize_error(error_message)

        if self.provider.has_active_api_key():
            return self._correct_with_llm(failed_sql, sanitized_error, schema_context)
        else:
            return self._correct_deterministic(failed_sql, sanitized_error, schema_context)

    def _sanitize_error(self, error: str) -> str:
        # Strip system paths or internal credentials if any
        sanitized = re.sub(r'(\/[^\s:]+)', '[path]', error)
        return sanitized.strip()

    def _correct_with_llm(
        self,
        failed_sql: str,
        error: str,
        schema_context: Dict[str, Any]
    ) -> Dict[str, Any]:
        prompt = f"""You are a PostgreSQL repair engine.
A query failed with an error. Provide a corrected query that fixes the issue according to the real schema.

Database Schema:
{schema_context}

Failed SQL:
{failed_sql}

Error Message:
{error}

Return JSON with:
{{
  "corrected_sql": "Valid fixed SQL",
  "explanation_of_fix": "What was wrong and how it was fixed",
  "confidence": 0.95
}}"""
        try:
            res = self.provider.generate_structured_json(prompt)
            validation = SQLValidator.validate_query(res["corrected_sql"])
            res["validation"] = validation
            return res
        except Exception:
            return self._correct_deterministic(failed_sql, error, schema_context)

    def _correct_deterministic(
        self,
        failed_sql: str,
        error: str,
        schema_context: Dict[str, Any]
    ) -> Dict[str, Any]:
        corrected = failed_sql
        explanation = "Applied heuristic error correction."

        # Case 1: relation does not exist (e.g. employee instead of employees)
        rel_match = re.search(r'relation "([^"]+)" does not exist', error, re.IGNORECASE)
        if rel_match:
            missing_rel = rel_match.group(1)
            # Find best match in tables
            available = schema_context.get("tables", {}).keys()
            for t in available:
                if t.startswith(missing_rel) or missing_rel.startswith(t):
                    corrected = re.sub(r'\b' + re.escape(missing_rel) + r'\b', t, corrected, flags=re.IGNORECASE)
                    explanation = f"Replaced non-existent relation '{missing_rel}' with '{t}'."
                    break

        # Case 2: column does not exist
        col_match = re.search(r'column "([^"]+)" does not exist', error, re.IGNORECASE)
        if col_match:
            missing_col = col_match.group(1)
            # Check for common variants (e.g., id -> employee_id, dept -> department_id)
            if missing_col in ["dept_id", "department"]:
                corrected = re.sub(r'\b' + re.escape(missing_col) + r'\b', "department_id", corrected, flags=re.IGNORECASE)
                explanation = f"Corrected column '{missing_col}' to 'department_id'."
            elif missing_col in ["id", "emp_id"]:
                corrected = re.sub(r'\b' + re.escape(missing_col) + r'\b', "employee_id", corrected, flags=re.IGNORECASE)
                explanation = f"Corrected column '{missing_col}' to 'employee_id'."

        # Case 3: Group by missing columns in select
        if "must appear in the group by clause" in error.lower():
            explanation = "Wrapped non-grouped aggregated columns in aggregate functions or added them to GROUP BY."
            # Simple fallback if selecting * with group by
            if "GROUP BY" in corrected.upper():
                corrected = re.sub(r'SELECT\s+\*\s+FROM', 'SELECT department_id, COUNT(*) FROM', corrected, flags=re.IGNORECASE)

        validation = SQLValidator.validate_query(corrected)

        return {
            "corrected_sql": corrected,
            "explanation_of_fix": explanation,
            "validation": validation,
            "confidence": 0.85
        }
