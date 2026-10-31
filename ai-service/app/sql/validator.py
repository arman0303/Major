import re
from typing import Dict, Any, List, Set, Optional
import sqlglot
from sqlglot import exp, parse_one, errors

class SQLValidator:
    """
    Validates PostgreSQL queries using SQLGlot AST parsing,
    enforcing permission policies, statement single-tenancy,
    and identifying accessed tables and columns.
    """
    
    DANGEROUS_COMMANDS = {
        "pg_sleep", "pg_read_file", "pg_write_file", "copy",
        "load", "grant", "revoke", "create role", "drop role",
        "alter system", "pg_terminate_backend"
    }

    MUTATION_TYPES = {"INSERT", "UPDATE", "DELETE"}
    DESTRUCTIVE_TYPES = {"DROP", "TRUNCATE", "ALTER"}
    READ_TYPES = {"SELECT"}

    @classmethod
    def validate_query(
        cls, 
        sql: str, 
        allowed_tables: Optional[Set[str]] = None
    ) -> Dict[str, Any]:
        """
        Parses and validates a SQL query string.
        Returns a dictionary with validation status, query_type, tables, columns, 
        requires_confirmation, and error details if any.
        """
        trimmed = sql.strip().rstrip(";")
        if not trimmed:
            return {
                "is_valid": False,
                "error": "Query cannot be empty",
                "query_type": "UNKNOWN"
            }

        # Check for multi-statement execution
        # A semicolon not inside quotes followed by another statement
        statements = sqlglot.parse(trimmed, read="postgres")
        if len(statements) > 1:
            return {
                "is_valid": False,
                "error": "Multiple SQL statements in a single execution are prohibited for security.",
                "query_type": "MULTI_STATEMENT",
                "requires_confirmation": True
            }

        try:
            expression = parse_one(trimmed, read="postgres")
        except errors.ParseError as e:
            return {
                "is_valid": False,
                "error": f"SQL Syntax Error: {str(e)}",
                "query_type": "SYNTAX_ERROR"
            }
        except Exception as e:
            return {
                "is_valid": False,
                "error": f"Parse Error: {str(e)}",
                "query_type": "UNKNOWN_ERROR"
            }

        if expression is None:
            return {
                "is_valid": False,
                "error": "Failed to parse SQL AST",
                "query_type": "UNKNOWN"
            }

        # Determine Query Type
        query_type = "UNKNOWN"
        if isinstance(expression, exp.Select):
            query_type = "SELECT"
        elif isinstance(expression, exp.Insert):
            query_type = "INSERT"
        elif isinstance(expression, exp.Update):
            query_type = "UPDATE"
        elif isinstance(expression, exp.Delete):
            query_type = "DELETE"
        elif isinstance(expression, exp.Create):
            query_type = "CREATE"
        elif isinstance(expression, exp.Drop):
            query_type = "DROP"
        elif isinstance(expression, exp.Alter):
            query_type = "ALTER"
        else:
            # Check string keyword fallback
            first_word = trimmed.split()[0].upper()
            if first_word in ["WITH", "EXPLAIN"]:
                query_type = "SELECT"
            else:
                query_type = first_word

        # Check for dangerous functions / commands
        lowered = trimmed.lower()
        for dangerous in cls.DANGEROUS_COMMANDS:
            if re.search(r'\b' + re.escape(dangerous) + r'\b', lowered):
                return {
                    "is_valid": False,
                    "error": f"Forbidden command or function detected: '{dangerous}'",
                    "query_type": "FORBIDDEN"
                }

        # Extract Tables
        tables = set()
        for table in expression.find_all(exp.Table):
            table_name = table.name.lower()
            if table_name:
                tables.add(table_name)

        # Extract Columns
        columns = set()
        for col in expression.find_all(exp.Column):
            col_name = col.name.lower()
            if col_name and col_name != "*":
                columns.add(col_name)

        # Check allowed tables if provided
        if allowed_tables:
            allowed_lowered = {t.lower() for t in allowed_tables}
            unauthorized = tables - allowed_lowered
            if unauthorized:
                return {
                    "is_valid": False,
                    "error": f"Query references tables not in current project schema: {', '.join(unauthorized)}",
                    "query_type": query_type,
                    "unauthorized_tables": list(unauthorized)
                }

        # Determine confirmation requirements
        requires_confirmation = False
        confirmation_reason = None

        if query_type in cls.DESTRUCTIVE_TYPES:
            requires_confirmation = True
            confirmation_reason = f"Destructive {query_type} statement requires explicit user confirmation."
        elif query_type in cls.MUTATION_TYPES:
            requires_confirmation = True
            confirmation_reason = f"{query_type} statement modifies database records and requires confirmation."

        # Count JOINs for complexity
        join_count = len(list(expression.find_all(exp.Join)))

        return {
            "is_valid": True,
            "query_type": query_type,
            "tables": sorted(list(tables)),
            "columns": sorted(list(columns)),
            "join_count": join_count,
            "requires_confirmation": requires_confirmation,
            "confirmation_reason": confirmation_reason,
            "formatted_sql": expression.sql(dialect="postgres", pretty=True)
        }
