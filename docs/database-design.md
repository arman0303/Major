# Database Design & Schema Architecture

## 1. Application Metadata Tables
1. **`users`**: User identity, hashed passwords, roles.
2. **`user_settings`**: Preferred LLM provider, user API keys, UI theme, row limits.
3. **`projects`**: Tenant boundary ensuring zero cross-user access to data or conversations.
4. **`datasets`**: Uploaded datasets, inferred column metadata, target table mappings.
5. **`conversations`**: Thread of messages per project.
6. **`messages`**: Conversational turns, natural language, generated SQL, query results, Recharts visualization config, and explanations.
7. **`query_history`**: Audit trail of every SQL execution, timing, affected rows, and status.
8. **`schema_metadata`**: Column names, data types, constraints, and descriptions.
9. **`relationships`**: Source/target foreign keys, relationship cardinality, confidence scores.
10. **`saved_queries`**: Named user queries.
11. **`dashboards`**: Multi-widget executive reports.
12. **`dashboard_widgets`**: Individual chart and metric components.
13. **`document_chunks`**: Segmented text chunks and 768-dimension pgvector embeddings for RAG.
14. **`execution_logs`**: Performance and query execution metrics.
15. **`import_logs`**: Log of dataset file conversions.

## 2. Sample Business Relational Tables
Included in `/sample-data` and seed scripts:
- **`departments`**: `(department_id, department_name, budget, location)`
- **`employees`**: `(employee_id, first_name, last_name, email, department_id, role, salary, hire_date, performance_rating)`
- **`projects_data`**: `(project_id, project_name, status, budget, start_date, end_date)`
- **`employee_projects`**: `(id, employee_id, project_id, role_in_project, allocation_pct)`
- **`sales_orders`**: `(order_id, order_date, customer_name, customer_region, product_category, product_name, unit_price, quantity, discount, total_amount, payment_method, status)`
