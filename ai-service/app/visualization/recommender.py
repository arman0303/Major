from typing import List, Dict, Any, Optional
import re

class ChartRecommender:
    """
    Analyzes returned database rows, column data types, cardinality,
    and query intent to automatically recommend the optimal visualization
    configuration for Recharts.
    """

    SUPPORTED_CHARTS = [
        "table", "bar", "grouped_bar", "stacked_bar",
        "pie", "donut", "line", "area", "scatter", "kpi"
    ]

    @classmethod
    def recommend(
        cls,
        rows: List[Dict[str, Any]],
        columns: List[str],
        query_intent: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Returns recommended chart type, x-axis, y-axis, available chart types,
        series configuration, and reasoning.
        """
        if not rows:
            return {
                "chart_type": "table",
                "available_charts": ["table"],
                "reason": "Empty result set."
            }

        if len(rows) == 1 and len(columns) == 1:
            col = columns[0]
            val = rows[0][col]
            return {
                "chart_type": "kpi",
                "available_charts": ["kpi", "table"],
                "kpi_label": col.replace("_", " ").title(),
                "kpi_value": val,
                "reason": "Single scalar value detected."
            }

        # Analyze column data types & cardinality
        numeric_cols = []
        date_cols = []
        categorical_cols = []

        sample_row = rows[0]
        for col in columns:
            val = sample_row.get(col)
            if isinstance(val, (int, float)) and not (isinstance(val, bool)):
                # Check if it's an ID column
                if col.lower().endswith("_id") or col.lower() == "id":
                    categorical_cols.append(col)
                else:
                    numeric_cols.append(col)
            elif isinstance(val, str):
                # Check for ISO date or date pattern
                if re.match(r'^\d{4}-\d{2}(-\d{2})?', val):
                    date_cols.append(col)
                else:
                    categorical_cols.append(col)
            else:
                categorical_cols.append(col)

        intent = (query_intent or "").lower()

        # Decision logic based on data profile and question intent
        # 1. Time-series / Date based -> Line or Area chart
        if date_cols and numeric_cols:
            x_col = date_cols[0]
            y_col = numeric_cols[0]
            chart_type = "area" if "cumulative" in intent or "growth" in intent else "line"
            return {
                "chart_type": chart_type,
                "x_axis": x_col,
                "y_axis": y_col,
                "y_axes": numeric_cols,
                "available_charts": ["line", "area", "bar", "table"],
                "reason": f"Time series detected on '{x_col}' with metric '{y_col}'."
            }

        # 2. Composition / Proportions / Category breakdown -> Pie or Donut chart
        if ("proportion" in intent or "percentage" in intent or "share" in intent or "contribution" in intent or "region" in intent) and categorical_cols and numeric_cols:
            if len(rows) <= 10:
                chart_type = "donut" if "donut" in intent else "pie"
                return {
                    "chart_type": chart_type,
                    "x_axis": categorical_cols[0],
                    "y_axis": numeric_cols[0],
                    "available_charts": ["pie", "donut", "bar", "table"],
                    "reason": f"Category distribution with {len(rows)} categories."
                }

        # 3. Categorical comparison -> Bar chart or Grouped/Stacked Bar
        if categorical_cols and numeric_cols:
            x_col = categorical_cols[0]
            y_col = numeric_cols[0]
            available = ["bar", "table"]
            if len(numeric_cols) > 1:
                available.extend(["grouped_bar", "stacked_bar", "line"])
            return {
                "chart_type": "bar",
                "x_axis": x_col,
                "y_axis": y_col,
                "y_axes": numeric_cols,
                "available_charts": available,
                "reason": f"Categorical breakdown of '{y_col}' by '{x_col}'."
            }

        # 4. Multi-numeric correlation -> Scatter plot
        if len(numeric_cols) >= 2 and not categorical_cols:
            return {
                "chart_type": "scatter",
                "x_axis": numeric_cols[0],
                "y_axis": numeric_cols[1],
                "available_charts": ["scatter", "table"],
                "reason": "Multi-variable correlation analysis."
            }

        return {
            "chart_type": "table",
            "available_charts": ["table"],
            "reason": "Data structure best displayed as tabular view."
        }
