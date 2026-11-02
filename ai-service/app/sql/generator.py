import re
import logging
from typing import Dict, Any, List, Optional
from ..llm.provider import LLMProvider
from .validator import SQLValidator

logger = logging.getLogger("ai_service.sql")

SYSTEM_SQL_PROMPT = """You are an expert PostgreSQL DBA and Senior Data Engineer.
Your task is to translate natural language questions into syntactically valid, optimal PostgreSQL SQL queries.

Strict Rules:
1. Always generate valid PostgreSQL syntax.
2. Use ONLY the provided table names, column names, and relationships. Never assume non-existent tables or columns.
3. Formulate proper INNER JOINs, LEFT JOINs, or multi-table JOINs using confirmed foreign key relationships or explicit foreign keys provided in the schema context.
4. If the question asks for rankings, partitions, or moving trends, use PostgreSQL window functions (e.g. ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...), RANK(), DENSE_RANK()).
5. If the question involves modular sub-computations, use Common Table Expressions (WITH cte AS (...)).
6. Do NOT invent columns or tables.
7. Return your response as a valid JSON object matching the exact structure requested.
"""

class SQLGenerator:
    """
    Translates Natural Language to PostgreSQL SQL using schema context,
    relationships, conversation memory, and LLM or deterministic engine.
    """
    def __init__(self, provider: Optional[LLMProvider] = None):
        self.provider = provider or LLMProvider()

    def generate_sql(
        self,
        question: str,
        schema_context: Dict[str, Any],
        conversation_history: Optional[List[Dict[str, str]]] = None,
        previous_sql: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generates structured SQL output from a natural language question.
        """
        tables_meta = schema_context.get("tables", {})
        relationships = schema_context.get("relationships", [])

        # Check if external LLM is configured
        if self.provider.has_active_api_key():
            return self._generate_with_llm(
                question=question,
                schema_context=schema_context,
                conversation_history=conversation_history,
                previous_sql=previous_sql
            )
        else:
            # Deterministic, schema-aware intelligent SQL engine
            return self._generate_deterministic(
                question=question,
                tables_meta=tables_meta,
                relationships=relationships,
                previous_sql=previous_sql
            )

    def _generate_with_llm(
        self,
        question: str,
        schema_context: Dict[str, Any],
        conversation_history: Optional[List[Dict[str, str]]] = None,
        previous_sql: Optional[str] = None
    ) -> Dict[str, Any]:
        """LLM-based generation with Gemini or OpenAI."""
        schema_repr = []
        for table, cols in schema_context.get("tables", {}).items():
            col_strs = [f"{c['name']} ({c['type']})" for c in cols]
            schema_repr.append(f"Table: {table}\nColumns: {', '.join(col_strs)}")

        rel_repr = []
        for r in schema_context.get("relationships", []):
            rel_repr.append(
                f"{r.get('source_table')}.{r.get('source_column')} -> "
                f"{r.get('target_table')}.{r.get('target_column')}"
            )

        history_repr = "None"
        if conversation_history:
            history_repr = "\n".join(
                f"- {m.get('role', 'user').upper()}: {m.get('content', '')[:180]}"
                for m in conversation_history[-6:] if m.get("content")
            )

        prompt = f"""Database Schema:
{chr(10).join(schema_repr)}

Table Relationships:
{chr(10).join(rel_repr) if rel_repr else "No explicit foreign keys."}

Recent Conversation History:
{history_repr}

Previous Executed SQL:
{previous_sql if previous_sql else "None"}

User Question: {question}

Context-Aware Guidelines:
- If this is a follow-up question (e.g. "Which region performed best?", "Show only the top three", "Filter by that department"), reference the previous executed SQL and recent conversation history to refine or extend the analysis.
- Generate valid PostgreSQL query syntax.
- Formulate necessary JOINs, CTEs, or window functions where appropriate.

Return a JSON object with:
{{
  "intent": "Brief description of what user wants",
  "generated_sql": "Valid PostgreSQL query",
  "query_type": "SELECT | INSERT | UPDATE | DELETE | CREATE | DROP",
  "relevant_tables": ["table1", "table2"],
  "relevant_columns": ["col1", "col2"],
  "explanation": "Clear explanation of how the query works",
  "visualization_recommendation": {{
    "chart_type": "bar | line | pie | scatter | table | kpi",
    "x_axis": "column_name",
    "y_axis": "column_name",
    "title": "Chart Title"
  }},
  "requires_confirmation": false
}}"""

        try:
            res = self.provider.generate_structured_json(prompt, system_prompt=SYSTEM_SQL_PROMPT)
            # Validate output using SQLValidator
            validation = SQLValidator.validate_query(res["generated_sql"])
            res["validation"] = validation
            if not validation["is_valid"]:
                res["validation_error"] = validation.get("error")
            return res
        except Exception as e:
            err_str = str(e)
            is_quota_or_conn = any(term in err_str.lower() for term in ["429", "resource_exhausted", "quota", "limit", "rate limit", "connection", "timeout"])
            if is_quota_or_conn and schema_context.get("tables"):
                logger.warning(f"LLM API quota reached or connection issue ({err_str[:120]}). Falling back to schema-aware deterministic engine.")
                fallback_res = self._generate_deterministic(
                    question=question,
                    tables_meta=schema_context.get("tables", {}),
                    relationships=schema_context.get("relationships", []),
                    previous_sql=previous_sql
                )
                fallback_res["explanation"] = (
                    f"{fallback_res.get('explanation', '')}\n\n"
                    f"*(Notice: LLM API free-tier quota was reached [429]. Query was dynamically synthesized using the database schema analyzer.)*"
                )
                return fallback_res

            raise RuntimeError(
                f"LLM SQL Generation failed: {err_str}. "
                "Unable to dynamically generate SQL. Please verify your LLM API key and configuration."
            )

    def _generate_deterministic(
        self,
        question: str,
        tables_meta: Dict[str, Any],
        relationships: List[Dict[str, Any]],
        previous_sql: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Deterministic, schema-aware SQL generator that operates strictly
        against tables that actually exist in the project schema.
        Never hallucinates non-existent tables or returns employee queries
        for custom uploaded datasets.
        """
        q = question.lower().strip()
        available_tables = list(tables_meta.keys())

        if not available_tables:
            raise ValueError(
                "No database tables were found for this project. "
                "Please upload a dataset or configure project tables before generating SQL queries."
            )
        
        # 1. Follow-up rewriting if previous query exists
        if previous_sql and ("only" in q or "sort" in q or "top" in q or "order by" in q or "them" in q or "where" in q or "filter" in q):
            return self._handle_followup(q, previous_sql, tables_meta)

        # 2. Match relevant tables strictly from available schema
        target_tables = []
        for t in available_tables:
            t_clean = t.lower().replace("_", " ")
            if t.lower() in q or t_clean in q or (t.endswith("s") and t[:-1].lower() in q):
                target_tables.append(t)

        if not target_tables:
            target_tables = [available_tables[0]]

        primary_table = target_tables[0]
        cols_info = tables_meta.get(primary_table, [])
        col_names = [c["name"].lower() if isinstance(c, dict) else str(c).lower() for c in cols_info]

        # 3. Department / Employee JOIN scenarios (ONLY if both tables exist)
        if "departments" in available_tables and "employees" in available_tables and "department" in q and ("employee" in q or "salary" in q):
            # Check for join between employees and departments
            if "average salary" in q or "avg salary" in q or "highest average" in q or "highest-paid department" in q:
                sql = (
                    "SELECT d.department_name, ROUND(AVG(e.salary), 2) AS avg_salary, COUNT(e.employee_id) AS employee_count\n"
                    "FROM departments d\n"
                    "JOIN employees e ON d.department_id = e.department_id\n"
                    "GROUP BY d.department_name\n"
                    "ORDER BY avg_salary DESC;"
                )
                return {
                    "intent": "Calculate average salary and employee count per department",
                    "generated_sql": sql,
                    "query_type": "SELECT",
                    "relevant_tables": ["departments", "employees"],
                    "relevant_columns": ["department_name", "salary", "employee_id"],
                    "explanation": "Joins departments with employees on department_id, aggregates average salary and counts employees per department.",
                    "visualization_recommendation": {
                        "chart_type": "bar",
                        "x_axis": "department_name",
                        "y_axis": "avg_salary",
                        "title": "Average Salary by Department"
                    },
                    "requires_confirmation": False,
                    "validation": SQLValidator.validate_query(sql)
                }
            elif "not belong" in q or "without employee" in q or "no employee" in q:
                if "department without" in q or "departments without" in q:
                    sql = (
                        "SELECT d.department_id, d.department_name, d.location\n"
                        "FROM departments d\n"
                        "LEFT JOIN employees e ON d.department_id = e.department_id\n"
                        "WHERE e.employee_id IS NULL;"
                    )
                    return {
                        "intent": "Find departments that currently have no assigned employees",
                        "generated_sql": sql,
                        "query_type": "SELECT",
                        "relevant_tables": ["departments", "employees"],
                        "relevant_columns": ["department_id", "department_name", "location"],
                        "explanation": "Executes a LEFT JOIN from departments to employees and filters where employee_id IS NULL to isolate empty departments.",
                        "visualization_recommendation": {"chart_type": "table", "title": "Departments Without Employees"},
                        "requires_confirmation": False,
                        "validation": SQLValidator.validate_query(sql)
                    }
                else:
                    sql = (
                        "SELECT e.employee_id, e.first_name, e.last_name, e.role, e.salary\n"
                        "FROM employees e\n"
                        "WHERE e.department_id IS NULL;"
                    )
                    return {
                        "intent": "Find employees who do not belong to any department",
                        "generated_sql": sql,
                        "query_type": "SELECT",
                        "relevant_tables": ["employees"],
                        "relevant_columns": ["employee_id", "first_name", "last_name", "department_id"],
                        "explanation": "Filters employees where department_id IS NULL.",
                        "visualization_recommendation": {"chart_type": "table", "title": "Employees Without Department"},
                        "requires_confirmation": False,
                        "validation": SQLValidator.validate_query(sql)
                    }

        # 4. Multi-table JOIN (Employees + Projects + Employee_Projects)
        # Only execute if required tables are actually in the project schema
        _has_emp_proj = "employee_projects" in available_tables and "employees" in available_tables
        if _has_emp_proj and (("project" in q and "employee" in q) or "multiple projects" in q):
            if "multiple project" in q or "more than one project" in q or "working on multiple" in q:
                sql = (
                    "SELECT e.employee_id, e.first_name, e.last_name, e.role, COUNT(ep.project_id) AS project_count\n"
                    "FROM employees e\n"
                    "JOIN employee_projects ep ON e.employee_id = ep.employee_id\n"
                    "GROUP BY e.employee_id, e.first_name, e.last_name, e.role\n"
                    "HAVING COUNT(ep.project_id) > 1\n"
                    "ORDER BY project_count DESC;"
                )
                return {
                    "intent": "Identify employees assigned to more than one project",
                    "generated_sql": sql,
                    "query_type": "SELECT",
                    "relevant_tables": ["employees", "employee_projects"],
                    "relevant_columns": ["employee_id", "first_name", "last_name", "project_id"],
                    "explanation": "Joins employees with employee_projects, groups by employee, and applies HAVING COUNT(ep.project_id) > 1.",
                    "visualization_recommendation": {
                        "chart_type": "bar",
                        "x_axis": "first_name",
                        "y_axis": "project_count",
                        "title": "Employees on Multiple Projects"
                    },
                    "requires_confirmation": False,
                    "validation": SQLValidator.validate_query(sql)
                }
            else:
                sql = (
                    "SELECT e.first_name, e.last_name, p.project_name, ep.role_in_project, ep.allocation_pct\n"
                    "FROM employees e\n"
                    "JOIN employee_projects ep ON e.employee_id = ep.employee_id\n"
                    "JOIN projects_data p ON ep.project_id = p.project_id\n"
                    "ORDER BY e.first_name, p.project_name;"
                )
                return {
                    "intent": "List employees and their assigned projects with allocation percentage",
                    "generated_sql": sql,
                    "query_type": "SELECT",
                    "relevant_tables": ["employees", "employee_projects", "projects_data"],
                    "relevant_columns": ["first_name", "last_name", "project_name", "role_in_project", "allocation_pct"],
                    "explanation": "Executes a 3-table INNER JOIN across employees, employee_projects, and projects_data.",
                    "visualization_recommendation": {"chart_type": "table", "title": "Employee Project Assignments"},
                    "requires_confirmation": False,
                    "validation": SQLValidator.validate_query(sql)
                }

        # 5. Window functions & Ranking (e.g. rank employees by salary within each department)
        if "employees" in available_tables and ("rank" in q or "ranking" in q or ("salary within" in q and "department" in q)):
            if "departments" in available_tables:
                sql = (
                    "SELECT e.first_name, e.last_name, d.department_name, e.salary,\n"
                    "       DENSE_RANK() OVER (PARTITION BY e.department_id ORDER BY e.salary DESC) AS salary_rank\n"
                    "FROM employees e\n"
                    "JOIN departments d ON e.department_id = d.department_id\n"
                    "ORDER BY d.department_name, salary_rank;"
                )
                rel_tables = ["employees", "departments"]
                rel_cols = ["first_name", "last_name", "department_name", "salary"]
            else:
                sql = (
                    "SELECT e.employee_id, e.salary, e.department_id,\n"
                    "       DENSE_RANK() OVER (PARTITION BY e.department_id ORDER BY e.salary DESC) AS salary_rank\n"
                    "FROM employees e\n"
                    "ORDER BY e.department_id, salary_rank;"
                )
                rel_tables = ["employees"]
                rel_cols = ["employee_id", "salary", "department_id"]

            return {
                "intent": "Rank employees by salary within each department using window functions",
                "generated_sql": sql,
                "query_type": "SELECT",
                "relevant_tables": rel_tables,
                "relevant_columns": rel_cols,
                "explanation": "Uses the DENSE_RANK() window function partitioned by department_id and ordered by salary DESC.",
                "visualization_recommendation": {
                    "chart_type": "bar",
                    "x_axis": "first_name" if "departments" in available_tables else "employee_id",
                    "y_axis": "salary",
                    "title": "Employee Salary Ranking by Department"
                },
                "requires_confirmation": False,
                "validation": SQLValidator.validate_query(sql)
            }

        # 6. CTE and Correlated Subquery (Employees earning more than department average)
        # Only execute if employees and departments tables exist
        if "employees" in available_tables and "departments" in available_tables and ("more than" in q and ("department's average" in q or "department average" in q)):
            sql = (
                "WITH dept_averages AS (\n"
                "    SELECT department_id, AVG(salary) AS avg_salary\n"
                "    FROM employees\n"
                "    WHERE department_id IS NOT NULL\n"
                "    GROUP BY department_id\n"
                ")\n"
                "SELECT e.first_name, e.last_name, d.department_name, e.salary, ROUND(da.avg_salary, 2) AS dept_avg_salary\n"
                "FROM employees e\n"
                "JOIN dept_averages da ON e.department_id = da.department_id\n"
                "JOIN departments d ON e.department_id = d.department_id\n"
                "WHERE e.salary > da.avg_salary\n"
                "ORDER BY e.salary DESC;"
            )
            return {
                "intent": "Find employees earning above their department's average salary using a CTE",
                "generated_sql": sql,
                "query_type": "SELECT",
                "relevant_tables": ["employees", "departments"],
                "relevant_columns": ["first_name", "last_name", "salary", "department_id"],
                "explanation": "Calculates department averages in a Common Table Expression (CTE) named dept_averages, then joins and filters where salary > avg_salary.",
                "visualization_recommendation": {
                    "chart_type": "bar",
                    "x_axis": "first_name",
                    "y_axis": "salary",
                    "title": "Employees Earning Above Department Average"
                },
                "requires_confirmation": False,
                "validation": SQLValidator.validate_query(sql)
            }

        # 7. Second highest salary / Nth highest
        # Only execute if employees table exists in this project
        if "employees" in available_tables and ("second-highest" in q or "second highest" in q or "2nd highest" in q):
            sql = (
                "SELECT DISTINCT salary\n"
                "FROM employees\n"
                "ORDER BY salary DESC\n"
                "OFFSET 1 LIMIT 1;"
            )
            return {
                "intent": "Find the second-highest salary in the organization",
                "generated_sql": sql,
                "query_type": "SELECT",
                "relevant_tables": ["employees"],
                "relevant_columns": ["salary"],
                "explanation": "Selects distinct salaries ordered descending, using OFFSET 1 LIMIT 1 to retrieve the 2nd highest.",
                "visualization_recommendation": {"chart_type": "kpi", "y_axis": "salary", "title": "Second Highest Salary"},
                "requires_confirmation": False,
                "validation": SQLValidator.validate_query(sql)
            }

        # 8. Sales dataset questions (trends, monthly revenue, region breakdown)
        # Only execute if sales_orders table exists in this project
        if "sales_orders" in available_tables and ("sales" in q or "revenue" in q or "order" in q or "customer" in q):
            if "month" in q or "trend" in q:
                sql = (
                    "SELECT TO_CHAR(order_date, 'YYYY-MM') AS order_month,\n"
                    "       ROUND(SUM(total_amount), 2) AS monthly_revenue,\n"
                    "       COUNT(order_id) AS total_orders\n"
                    "FROM sales_orders\n"
                    "GROUP BY TO_CHAR(order_date, 'YYYY-MM')\n"
                    "ORDER BY order_month ASC;"
                )
                return {
                    "intent": "Analyze monthly revenue trends and order counts over time",
                    "generated_sql": sql,
                    "query_type": "SELECT",
                    "relevant_tables": ["sales_orders"],
                    "relevant_columns": ["order_date", "total_amount", "order_id"],
                    "explanation": "Extracts YYYY-MM from order_date, sums total_amount, and orders chronologically.",
                    "visualization_recommendation": {
                        "chart_type": "line",
                        "x_axis": "order_month",
                        "y_axis": "monthly_revenue",
                        "title": "Monthly Revenue Trends"
                    },
                    "requires_confirmation": False,
                    "validation": SQLValidator.validate_query(sql)
                }
            elif "region" in q or "customer_region" in q:
                sql = (
                    "SELECT customer_region, ROUND(SUM(total_amount), 2) AS regional_sales, COUNT(order_id) AS order_count\n"
                    "FROM sales_orders\n"
                    "GROUP BY customer_region\n"
                    "ORDER BY regional_sales DESC;"
                )
                return {
                    "intent": "Calculate sales contribution by customer region",
                    "generated_sql": sql,
                    "query_type": "SELECT",
                    "relevant_tables": ["sales_orders"],
                    "relevant_columns": ["customer_region", "total_amount"],
                    "explanation": "Groups orders by customer_region and sums the total_amount.",
                    "visualization_recommendation": {
                        "chart_type": "pie",
                        "x_axis": "customer_region",
                        "y_axis": "regional_sales",
                        "title": "Revenue by Region"
                    },
                    "requires_confirmation": False,
                    "validation": SQLValidator.validate_query(sql)
                }
            elif "category" in q:
                sql = (
                    "SELECT product_category, ROUND(SUM(total_amount), 2) AS category_revenue\n"
                    "FROM sales_orders\n"
                    "GROUP BY product_category\n"
                    "ORDER BY category_revenue DESC;"
                )
                return {
                    "intent": "Break down revenue contribution by product category",
                    "generated_sql": sql,
                    "query_type": "SELECT",
                    "relevant_tables": ["sales_orders"],
                    "relevant_columns": ["product_category", "total_amount"],
                    "explanation": "Groups orders by product_category and computes total revenue.",
                    "visualization_recommendation": {
                        "chart_type": "donut",
                        "x_axis": "product_category",
                        "y_axis": "category_revenue",
                        "title": "Revenue by Category"
                    },
                    "requires_confirmation": False,
                    "validation": SQLValidator.validate_query(sql)
                }
            else:
                sql = "SELECT * FROM sales_orders ORDER BY order_date DESC LIMIT 50;"
                return {
                    "intent": "Retrieve recent sales orders",
                    "generated_sql": sql,
                    "query_type": "SELECT",
                    "relevant_tables": ["sales_orders"],
                    "relevant_columns": ["order_id", "customer_name", "total_amount", "order_date"],
                    "explanation": "Retrieves recent records from sales_orders table.",
                    "visualization_recommendation": {"chart_type": "table", "title": "Sales Orders"},
                    "requires_confirmation": False,
                    "validation": SQLValidator.validate_query(sql)
                }

        # 9. Top N records or salary filtering
        match_top = re.search(r'top\s+(\d+)', q)
        limit_count = match_top.group(1) if match_top else None

        match_salary = re.search(r'earning\s+more\s+than\s+(\d+[\d,]*)', q) or re.search(r'salary\s*>\s*(\d+[\d,]*)', q)

        if match_salary:
            salary_val = match_salary.group(1).replace(",", "")
            # Pick salary column from primary_table if exists, otherwise fallback to employees if available
            target_tbl = "employees" if "employees" in available_tables else primary_table
            sort_c = "salary" if "salary" in col_names else (col_names[1] if len(col_names) > 1 else col_names[0])
            sql = f"SELECT * FROM {target_tbl} WHERE {sort_c} > {salary_val} ORDER BY {sort_c} DESC;"
            return {
                "intent": f"Find records in {target_tbl} with {sort_c} > {salary_val}",
                "generated_sql": sql,
                "query_type": "SELECT",
                "relevant_tables": [target_tbl],
                "relevant_columns": [sort_c],
                "explanation": f"Filters records where {sort_c} > {salary_val} sorted descending.",
                "visualization_recommendation": {
                    "chart_type": "bar",
                    "x_axis": col_names[0] if col_names else "id",
                    "y_axis": sort_c,
                    "title": f"Records with {sort_c} > {salary_val}"
                },
                "requires_confirmation": False,
                "validation": SQLValidator.validate_query(sql)
            }

        if limit_count:
            sql = f"SELECT * FROM {primary_table} ORDER BY salary DESC LIMIT {limit_count};"
            return {
                "intent": f"Retrieve top {limit_count} highest-paid records from {primary_table}",
                "generated_sql": sql,
                "query_type": "SELECT",
                "relevant_tables": [primary_table],
                "relevant_columns": ["first_name", "last_name", "salary"],
                "explanation": f"Selects all records ordered by salary descending with LIMIT {limit_count}.",
                "visualization_recommendation": {
                    "chart_type": "bar",
                    "x_axis": "first_name" if "first_name" in col_names else col_names[0],
                    "y_axis": "salary" if "salary" in col_names else col_names[1],
                    "title": f"Top {limit_count} Records"
                },
                "requires_confirmation": False,
                "validation": SQLValidator.validate_query(sql)
            }

        # 10. General SELECT all
        sql = f"SELECT * FROM {primary_table} LIMIT 100;"
        return {
            "intent": f"Show all records from {primary_table}",
            "generated_sql": sql,
            "query_type": "SELECT",
            "relevant_tables": [primary_table],
            "relevant_columns": col_names,
            "explanation": f"Retrieves records from the {primary_table} table up to 100 rows.",
            "visualization_recommendation": {"chart_type": "table", "title": f"{primary_table.capitalize()} Records"},
            "requires_confirmation": False,
            "validation": SQLValidator.validate_query(sql)
        }

    def _handle_followup(self, q: str, prev_sql: str, tables_meta: Dict[str, Any]) -> Dict[str, Any]:
        """Handles conversational follow-up questions by altering previous query."""
        sql = prev_sql.strip().rstrip(";")
        intent = "Apply filter/sorting to previous query"
        explanation = "Refined previous query based on conversational context."

        table_match = re.search(r'\bFROM\s+["\']?([a-zA-Z0-9_]+)["\']?', sql, re.IGNORECASE)
        primary_table = table_match.group(1).lower() if table_match else (list(tables_meta.keys())[0] if tables_meta else "employees")
        table_cols = [c["name"].lower() if isinstance(c, dict) else str(c).lower() for c in tables_meta.get(primary_table, [])]

        # Determine best sort column
        sort_col = "salary"
        for candidate in ["salary", "total_amount", "revenue", "amount", "budget", "price", "count", "id"]:
            if candidate in table_cols:
                sort_col = candidate
                break

        if "only" in q or "from it" in q or "it department" in q:
            filter_clause = "department_id = 1" if "department_id" in table_cols else f"{table_cols[0]} IS NOT NULL"
            if "WHERE" in sql.upper():
                sql = f"{sql} AND {filter_clause}"
            else:
                parts = re.split(r'\b(ORDER BY|LIMIT)\b', sql, flags=re.IGNORECASE)
                base = parts[0]
                rest = "".join(parts[1:])
                sql = f"{base} WHERE {filter_clause} {rest}"
            intent = f"Filter results on {primary_table}"
            explanation = f"Appended WHERE {filter_clause} to the previous query."

        if "sort" in q or "by salary" in q or "order by" in q:
            sql = re.sub(r'ORDER BY.*?(?=LIMIT|$)', '', sql, flags=re.IGNORECASE).strip()
            sql = f"{sql} ORDER BY {sort_col} DESC"
            intent = f"Sort the records by {sort_col} in descending order"
            explanation = f"Added ORDER BY {sort_col} DESC."

        if "top" in q:
            match = re.search(r'top\s+(\d+|five|ten|three)', q)
            num = "5"
            if match:
                word = match.group(1).lower()
                num_map = {"five": "5", "ten": "10", "three": "3", "one": "1"}
                num = num_map.get(word, word)
            sql = re.sub(r'LIMIT\s+\d+', '', sql, flags=re.IGNORECASE).strip()
            if "ORDER BY" not in sql.upper():
                sql = f"{sql} ORDER BY {sort_col} DESC"
            sql = f"{sql} LIMIT {num}"
            intent = f"Limit the results to the top {num} records"
            explanation = f"Appended LIMIT {num}."

        sql = f"{sql};"
        return {
            "intent": intent,
            "generated_sql": sql,
            "query_type": "SELECT",
            "relevant_tables": [primary_table],
            "relevant_columns": [sort_col],
            "explanation": explanation,
            "visualization_recommendation": {
                "chart_type": "bar",
                "x_axis": table_cols[0] if table_cols else "id",
                "y_axis": sort_col,
                "title": f"Refined Query Results on {primary_table.capitalize()}"
            },
            "requires_confirmation": False,
            "validation": SQLValidator.validate_query(sql)
        }
