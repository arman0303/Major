import re
from typing import Dict, Any, List, Optional
from ..llm.provider import LLMProvider

class SchemaCreator:
    """
    Transforms natural language database specifications into PostgreSQL
    relational DDL, tables, primary/foreign keys, constraints, and ER diagram nodes/edges.
    """
    def __init__(self, provider: Optional[LLMProvider] = None):
        self.provider = provider or LLMProvider()

    def generate_schema_from_prompt(self, prompt: str) -> Dict[str, Any]:
        """
        Parses user specification and creates relational tables, DDL commands,
        and ER diagram metadata.
        """
        if self.provider.has_active_api_key():
            return self._generate_with_llm(prompt)
        else:
            return self._generate_deterministic(prompt)

    def _generate_with_llm(self, prompt: str) -> Dict[str, Any]:
        system_prompt = """You are a Principal Database Architect specializing in PostgreSQL relational modeling.
Analyze the user's database requirements and generate:
1. Relational tables with proper column types (SERIAL, VARCHAR, NUMERIC, TIMESTAMP, etc.)
2. Primary keys, foreign key constraints (ON DELETE CASCADE/SET NULL), NOT NULL, UNIQUE constraints.
3. Clean PostgreSQL CREATE TABLE statements.
4. ER diagram nodes (tables with columns) and edges (relationships).

Return valid JSON with:
{
  "summary": "High level architecture overview",
  "tables": [
    {
      "name": "table_name",
      "columns": [
        {"name": "col_name", "type": "VARCHAR(100)", "is_pk": true, "is_fk": false, "nullable": false}
      ]
    }
  ],
  "relationships": [
    {"source_table": "employees", "source_col": "dept_id", "target_table": "departments", "target_col": "id", "type": "many-to-one"}
  ],
  "ddl_statements": [
    "CREATE TABLE ...;"
  ],
  "requires_confirmation": true
}"""
        try:
            return self.provider.generate_structured_json(prompt, system_prompt=system_prompt)
        except Exception:
            return self._generate_deterministic(prompt)

    def _generate_deterministic(self, prompt: str) -> Dict[str, Any]:
        p = prompt.lower()
        
        # Check if company / employee / project management is mentioned
        if "employee" in p or "company" in p or "department" in p:
            ddl = [
                """CREATE TABLE IF NOT EXISTS departments (
    department_id SERIAL PRIMARY KEY,
    department_name VARCHAR(100) NOT NULL UNIQUE,
    budget NUMERIC(15, 2) NOT NULL,
    location VARCHAR(100) NOT NULL
);""",
                """CREATE TABLE IF NOT EXISTS employees (
    employee_id SERIAL PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    department_id INTEGER REFERENCES departments(department_id) ON DELETE SET NULL,
    role VARCHAR(100) NOT NULL,
    salary NUMERIC(12, 2) NOT NULL,
    hire_date DATE NOT NULL,
    performance_rating NUMERIC(3, 2) DEFAULT 4.0
);""",
                """CREATE TABLE IF NOT EXISTS projects (
    project_id SERIAL PRIMARY KEY,
    project_name VARCHAR(150) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Active',
    budget NUMERIC(15, 2) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE
);""",
                """CREATE TABLE IF NOT EXISTS employee_projects (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    role_in_project VARCHAR(100) NOT NULL,
    allocation_pct INTEGER NOT NULL CHECK (allocation_pct > 0 AND allocation_pct <= 100),
    UNIQUE(employee_id, project_id)
);"""
            ]

            tables = [
                {
                    "name": "departments",
                    "columns": [
                        {"name": "department_id", "type": "SERIAL", "is_pk": True, "is_fk": False, "nullable": False},
                        {"name": "department_name", "type": "VARCHAR(100)", "is_pk": False, "is_fk": False, "nullable": False},
                        {"name": "budget", "type": "NUMERIC(15,2)", "is_pk": False, "is_fk": False, "nullable": False},
                        {"name": "location", "type": "VARCHAR(100)", "is_pk": False, "is_fk": False, "nullable": False}
                    ]
                },
                {
                    "name": "employees",
                    "columns": [
                        {"name": "employee_id", "type": "SERIAL", "is_pk": True, "is_fk": False, "nullable": False},
                        {"name": "first_name", "type": "VARCHAR(50)", "is_pk": False, "is_fk": False, "nullable": False},
                        {"name": "last_name", "type": "VARCHAR(50)", "is_pk": False, "is_fk": False, "nullable": False},
                        {"name": "email", "type": "VARCHAR(100)", "is_pk": False, "is_fk": False, "nullable": False},
                        {"name": "department_id", "type": "INTEGER", "is_pk": False, "is_fk": True, "nullable": True},
                        {"name": "role", "type": "VARCHAR(100)", "is_pk": False, "is_fk": False, "nullable": False},
                        {"name": "salary", "type": "NUMERIC(12,2)", "is_pk": False, "is_fk": False, "nullable": False},
                        {"name": "hire_date", "type": "DATE", "is_pk": False, "is_fk": False, "nullable": False}
                    ]
                },
                {
                    "name": "projects",
                    "columns": [
                        {"name": "project_id", "type": "SERIAL", "is_pk": True, "is_fk": False, "nullable": False},
                        {"name": "project_name", "type": "VARCHAR(150)", "is_pk": False, "is_fk": False, "nullable": False},
                        {"name": "status", "type": "VARCHAR(50)", "is_pk": False, "is_fk": False, "nullable": False},
                        {"name": "budget", "type": "NUMERIC(15,2)", "is_pk": False, "is_fk": False, "nullable": False}
                    ]
                },
                {
                    "name": "employee_projects",
                    "columns": [
                        {"name": "id", "type": "SERIAL", "is_pk": True, "is_fk": False, "nullable": False},
                        {"name": "employee_id", "type": "INTEGER", "is_pk": False, "is_fk": True, "nullable": False},
                        {"name": "project_id", "type": "INTEGER", "is_pk": False, "is_fk": True, "nullable": False},
                        {"name": "role_in_project", "type": "VARCHAR(100)", "is_pk": False, "is_fk": False, "nullable": False},
                        {"name": "allocation_pct", "type": "INTEGER", "is_pk": False, "is_fk": False, "nullable": False}
                    ]
                }
            ]

            relationships = [
                {
                    "source_table": "employees",
                    "source_col": "department_id",
                    "target_table": "departments",
                    "target_col": "department_id",
                    "type": "many-to-one"
                },
                {
                    "source_table": "employee_projects",
                    "source_col": "employee_id",
                    "target_table": "employees",
                    "target_col": "employee_id",
                    "type": "many-to-one"
                },
                {
                    "source_table": "employee_projects",
                    "source_col": "project_id",
                    "target_table": "projects",
                    "target_col": "project_id",
                    "type": "many-to-one"
                }
            ]

            return {
                "summary": "Company Management relational database with 4 normalized tables and foreign key constraints.",
                "tables": tables,
                "relationships": relationships,
                "ddl_statements": ddl,
                "requires_confirmation": True
            }

        # Generic table generation
        clean_name = re.sub(r'[^a-zA-Z0-9_]', '_', p[:20]).strip("_") or "custom_entity"
        ddl = [
            f"""CREATE TABLE IF NOT EXISTS {clean_name} (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);"""
        ]
        return {
            "summary": f"Relational entity for '{clean_name}'.",
            "tables": [{
                "name": clean_name,
                "columns": [
                    {"name": "id", "type": "SERIAL", "is_pk": True, "is_fk": False, "nullable": False},
                    {"name": "name", "type": "VARCHAR(150)", "is_pk": False, "is_fk": False, "nullable": False},
                    {"name": "description", "type": "TEXT", "is_pk": False, "is_fk": False, "nullable": True},
                    {"name": "created_at", "type": "TIMESTAMP", "is_pk": False, "is_fk": False, "nullable": True}
                ]
            }],
            "relationships": [],
            "ddl_statements": ddl,
            "requires_confirmation": True
        }
