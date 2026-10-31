from typing import Dict, Any, Optional
import sqlglot
from sqlglot import exp
from ..llm.provider import LLMProvider

class SQLExplainer:
    """
    Produces human-readable explanations of SQL queries in both
    'simple' (for business analysts/beginners) and 'technical'
    (for engineers/DBAs) modes.
    """
    def __init__(self, provider: Optional[LLMProvider] = None):
        self.provider = provider or LLMProvider()

    def explain(self, sql: str, schema_context: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
        """
        Returns simple and technical explanations for the SQL query.
        """
        if self.provider.has_active_api_key():
            return self._explain_with_llm(sql)
        else:
            return self._explain_deterministic(sql)

    def _explain_with_llm(self, sql: str) -> Dict[str, str]:
        prompt = f"""Explain this PostgreSQL query in two modes:
1. 'simple': Plain conversational English for non-technical users. Mention what data is retrieved in business terms.
2. 'technical': For database engineers. Mention joins, index usage implications, grouping, filtering conditions, window functions, and time complexity.

SQL:
{sql}

Return JSON with:
{{
  "simple": "Simple explanation...",
  "technical": "Technical explanation..."
}}"""
        try:
            return self.provider.generate_structured_json(prompt)
        except Exception:
            return self._explain_deterministic(sql)

    def _explain_deterministic(self, sql: str) -> Dict[str, str]:
        try:
            parsed = sqlglot.parse_one(sql, read="postgres")
        except Exception:
            return {
                "simple": "Executes the requested SQL command to retrieve or modify data.",
                "technical": "Raw SQL statement execution."
            }

        tables = [t.name for t in parsed.find_all(exp.Table)]
        joins = list(parsed.find_all(exp.Join))
        where = parsed.find(exp.Where)
        group = parsed.find(exp.Group)
        order = parsed.find(exp.Order)
        limit = parsed.find(exp.Limit)
        windows = list(parsed.find_all(exp.Window))
        ctes = list(parsed.find_all(exp.CTE))

        simple_points = []
        tech_points = []

        if ctes:
            simple_points.append(f"Calculates preliminary helper calculations using temporary sub-tables ({', '.join([c.alias for c in ctes])}).")
            tech_points.append(f"Defines Common Table Expressions (CTEs): {', '.join([c.alias for c in ctes])}.")

        if tables:
            simple_points.append(f"Reads information from the {', '.join(set(tables))} table(s).")
            tech_points.append(f"Target relations: {', '.join(set(tables))}.")

        if joins:
            join_types = [j.args.get("kind", "INNER") or "INNER" for j in joins]
            simple_points.append(f"Connects related records across multiple tables using {len(joins)} relationship link(s).")
            tech_points.append(f"Executes {len(joins)} relational JOIN operation(s) ({', '.join(join_types)}). Ensure foreign keys are indexed.")

        if where:
            simple_points.append("Filters records to only include rows that match the specified criteria.")
            tech_points.append(f"Applies WHERE predicate filter: `{where.this.sql(dialect='postgres')}`.")

        if group:
            simple_points.append("Summarizes and groups the data into category aggregates.")
            tech_points.append("Groups results using GROUP BY hash/sort aggregation.")

        if windows:
            simple_points.append("Computes analytical ranking and running totals across partitions of the dataset.")
            tech_points.append(f"Applies {len(windows)} analytic window function(s) over data partitions.")

        if order:
            simple_points.append("Sorts the final results into the desired sequence.")
            tech_points.append("Applies ORDER BY sorting on result set.")

        if limit:
            simple_points.append(f"Restricts the output to the top {limit.expression.sql()} rows.")
            tech_points.append(f"Applies LIMIT {limit.expression.sql()} to bound returned cardinality.")

        return {
            "simple": " ".join(simple_points) if simple_points else "Queries the database for matching records.",
            "technical": " | ".join(tech_points) if tech_points else "Standard SELECT projection."
        }
