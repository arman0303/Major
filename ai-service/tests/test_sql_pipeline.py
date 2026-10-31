import pytest
from app.sql.validator import SQLValidator
from app.sql.generator import SQLGenerator
from app.sql.explainer import SQLExplainer
from app.sql.corrector import SQLCorrector
from app.visualization.recommender import ChartRecommender
from app.analytics.insights import AnalyticsEngine

def test_sql_validator_select():
    sql = "SELECT e.first_name, d.department_name FROM employees e JOIN departments d ON e.department_id = d.department_id WHERE e.salary > 50000;"
    result = SQLValidator.validate_query(sql)
    assert result["is_valid"] is True
    assert result["query_type"] == "SELECT"
    assert "employees" in result["tables"]
    assert "departments" in result["tables"]
    assert result["requires_confirmation"] is False

def test_sql_validator_mutation_confirmation():
    sql = "UPDATE employees SET salary = salary * 1.1 WHERE department_id = 1;"
    result = SQLValidator.validate_query(sql)
    assert result["is_valid"] is True
    assert result["query_type"] == "UPDATE"
    assert result["requires_confirmation"] is True

def test_sql_validator_blocks_multi_statement():
    sql = "SELECT * FROM employees; DROP TABLE employees;"
    result = SQLValidator.validate_query(sql)
    assert result["is_valid"] is False
    assert "Multiple SQL statements" in result["error"]

def test_sql_validator_blocks_dangerous_functions():
    sql = "SELECT pg_sleep(10);"
    result = SQLValidator.validate_query(sql)
    assert result["is_valid"] is False
    assert "Forbidden" in result["error"]

def test_text_to_sql_joins():
    generator = SQLGenerator()
    schema_context = {
        "tables": {
            "departments": [{"name": "department_id", "type": "INTEGER"}, {"name": "department_name", "type": "VARCHAR"}],
            "employees": [{"name": "employee_id", "type": "INTEGER"}, {"name": "salary", "type": "NUMERIC"}, {"name": "department_id", "type": "INTEGER"}]
        },
        "relationships": [
            {"source_table": "employees", "source_column": "department_id", "target_table": "departments", "target_column": "department_id"}
        ]
    }
    
    res = generator.generate_sql("Show the average salary of every department", schema_context)
    assert res["query_type"] == "SELECT"
    assert "JOIN employees" in res["generated_sql"] or "JOIN departments" in res["generated_sql"]
    assert "AVG" in res["generated_sql"].upper()
    assert "GROUP BY" in res["generated_sql"].upper()

def test_text_to_sql_window_functions():
    generator = SQLGenerator()
    schema_context = {
        "tables": {
            "employees": [{"name": "employee_id", "type": "INTEGER"}, {"name": "salary", "type": "NUMERIC"}, {"name": "department_id", "type": "INTEGER"}]
        }
    }
    res = generator.generate_sql("Rank employees by salary within each department", schema_context)
    assert "DENSE_RANK()" in res["generated_sql"] or "RANK()" in res["generated_sql"]
    assert "OVER" in res["generated_sql"]

def test_chart_recommender():
    rows = [
        {"department": "Engineering", "avg_salary": 125000},
        {"department": "Sales", "avg_salary": 95000},
        {"department": "HR", "avg_salary": 75000}
    ]
    rec = ChartRecommender.recommend(rows, ["department", "avg_salary"], "Show average salary by department")
    assert rec["chart_type"] == "bar"
    assert rec["x_axis"] == "department"
    assert rec["y_axis"] == "avg_salary"

def test_analytics_engine_insights():
    rows = [
        {"val": 10}, {"val": 12}, {"val": 11}, {"val": 13}, {"val": 100} # 100 is outlier
    ]
    insights = AnalyticsEngine.generate_insights(rows, ["val"])
    assert "statistics" in insights
    assert insights["statistics"]["val"]["count"] == 5
    assert len(insights["insights"]) > 0
    assert any("outlier" in i.lower() for i in insights["insights"])

def test_sql_corrector():
    corrector = SQLCorrector()
    schema_context = {"tables": {"employees": [{"name": "department_id", "type": "INTEGER"}]}}
    res = corrector.correct_sql(
        failed_sql="SELECT * FROM employee WHERE dept_id = 1",
        error_message='relation "employee" does not exist',
        schema_context=schema_context
    )
    assert "employees" in res["corrected_sql"]
