import re
from typing import Dict, Any, List, Set, Optional
import sqlglot
from sqlglot import exp, parse_one, errors


class SQLValidator:
    """
    Validates PostgreSQL queries using SQLGlot AST parsing,
    enforcing permission policies, statement single-tenancy,
    identifying accessed tables/columns, and verifying against schema context.
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
        allowed_tables: Optional[Set[str]] = None,
        schema_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Parses and validates a SQL query string using AST traversal.
        Validates syntax, query type, permissions, dangerous functions,
        referenced tables, and referenced columns.
        """
        trimmed = sql.strip().rstrip(";")
        if not trimmed:
            return {
                "is_valid": False,
                "error": "Query cannot be empty",
                "query_type": "UNKNOWN"
            }

        # 1. Check for multi-statement execution via SQLGlot parser
        try:
            statements = sqlglot.parse(trimmed, read="postgres")
            if len(statements) > 1:
                return {
                    "is_valid": False,
                    "error": "Security Violation: Multiple SQL statements in a single execution are prohibited.",
                    "query_type": "MULTI_STATEMENT",
                    "requires_confirmation": True
                }
        except Exception:
            pass

        # 2. Parse Single AST
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

        # 3. Determine Query Type
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
            first_word = trimmed.split()[0].upper()
            if first_word in ["WITH", "EXPLAIN"]:
                query_type = "SELECT"
            else:
                query_type = first_word

        # 4. Check for dangerous administrative commands and injection patterns
        lowered = trimmed.lower()
        for dangerous in cls.DANGEROUS_COMMANDS:
            if re.search(r'\b' + re.escape(dangerous) + r'\b', lowered):
                return {
                    "is_valid": False,
                    "error": f"Security Violation: Forbidden command or function detected: '{dangerous}'",
                    "query_type": "FORBIDDEN"
                }

        # 5. Extract CTE Names (they act as valid local table aliases, not external tables)
        cte_names = set()
        for cte in expression.find_all(exp.CTE):
            if cte.alias:
                cte_names.add(cte.alias.lower())

        # 6. Extract Tables and Table Aliases
        tables = set()
        table_alias_map = {}
        for table in expression.find_all(exp.Table):
            table_name = table.name.lower()
            if table_name:
                tables.add(table_name)
                if table.alias:
                    table_alias_map[table.alias.lower()] = table_name

        # Also catch subquery aliases
        for subq in expression.find_all(exp.Subquery):
            if subq.alias:
                cte_names.add(subq.alias.lower())

        # 7. Extract SELECT Column Aliases (e.g. SELECT x AS my_alias)
        select_aliases = set()
        for s in expression.find_all(exp.Select):
            for exp_item in s.expressions:
                if isinstance(exp_item, exp.Alias):
                    select_aliases.add(exp_item.alias.lower())

        # 8. Extract Referenced Columns
        columns = set()
        for col in expression.find_all(exp.Column):
            col_name = col.name.lower()
            if col_name and col_name != "*":
                columns.add(col_name)

        # 9. Schema Validation against allowed_tables
        actual_referenced_tables = tables - cte_names
        effective_allowed = None
        if allowed_tables:
            effective_allowed = {t.lower() for t in allowed_tables}
        elif schema_context and "tables" in schema_context:
            effective_allowed = {t.lower() for t in schema_context["tables"].keys()}

        if effective_allowed:
            unauthorized = actual_referenced_tables - effective_allowed
            if unauthorized:
                return {
                    "is_valid": False,
                    "error": f"Schema Validation Error: Query references non-existent table(s): {', '.join(sorted(unauthorized))}",
                    "query_type": query_type,
                    "unauthorized_tables": list(unauthorized),
                    "tables": sorted(list(tables)),
                    "columns": sorted(list(columns))
                }

        # 10. Column Validation against Schema Context
        if schema_context and "tables" in schema_context and schema_context["tables"]:
            schema_cols: Dict[str, Set[str]] = {}
            for t_name, c_list in schema_context["tables"].items():
                col_set = set()
                for c in c_list:
                    if isinstance(c, dict):
                        col_set.add(c.get("name", "").lower())
                    else:
                        col_set.add(str(c).lower())
                schema_cols[t_name.lower()] = col_set

            missing_columns = []
            for col in expression.find_all(exp.Column):
                c_name = col.name.lower()
                if c_name == "*" or c_name in select_aliases or c_name in cte_names:
                    continue

                t_qualifier = col.table.lower() if col.table else None
                if t_qualifier:
                    if t_qualifier in cte_names:
                        continue  # Column on a CTE result set
                    real_table = table_alias_map.get(t_qualifier, t_qualifier)
                    if real_table in schema_cols:
                        if c_name not in schema_cols[real_table]:
                            missing_columns.append(f"{c_name} (in table '{real_table}')")
                else:
                    # Unqualified column: must belong to at least one referenced real table or CTE
                    found = False
                    for t in actual_referenced_tables:
                        if t in schema_cols and c_name in schema_cols[t]:
                            found = True
                            break
                    if not found and not any(c_name in cte_names for cte in cte_names):
                        # Special check: check if it matches a SQL window function or function name
                        if not isinstance(col.parent, (exp.Anonymous, exp.Func)):
                            missing_columns.append(c_name)

            if missing_columns:
                return {
                    "is_valid": False,
                    "error": f"Schema Validation Error: Query references non-existent column(s): {', '.join(sorted(set(missing_columns)))}",
                    "query_type": query_type,
                    "missing_columns": sorted(list(set(missing_columns))),
                    "tables": sorted(list(tables)),
                    "columns": sorted(list(columns))
                }

        # 11. Determine Confirmation Requirements
        requires_confirmation = False
        confirmation_reason = None

        if query_type in cls.DESTRUCTIVE_TYPES:
            requires_confirmation = True
            confirmation_reason = f"Destructive {query_type} statement requires explicit user confirmation."
        elif query_type in cls.MUTATION_TYPES:
            requires_confirmation = True
            confirmation_reason = f"{query_type} statement modifies database records and requires confirmation."

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
