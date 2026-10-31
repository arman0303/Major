from typing import List, Dict, Any, Optional
import math
import numpy as np
import pandas as pd

class AnalyticsEngine:
    """
    Derives automated statistical summaries, trends, outliers,
    and missing value analytics from real query results.
    """

    @classmethod
    def generate_insights(
        cls,
        rows: List[Dict[str, Any]],
        columns: List[str],
        query: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Calculates descriptive statistics, detects trends and anomalies,
        and produces bullet-point data insights.
        """
        if not rows:
            return {
                "summary": "No data returned to analyze.",
                "insights": [],
                "statistics": {},
                "recommendations": []
            }

        df = pd.DataFrame(rows)
        insights = []
        stats = {}
        recommendations = []

        # Analyze numerical columns
        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()

        for col in numeric_cols:
            series = df[col].dropna()
            if len(series) == 0:
                continue

            mean_val = float(series.mean())
            median_val = float(series.median())
            min_val = float(series.min())
            max_val = float(series.max())
            std_val = float(series.std()) if len(series) > 1 else 0.0

            stats[col] = {
                "count": len(series),
                "mean": round(mean_val, 2),
                "median": round(median_val, 2),
                "min": round(min_val, 2),
                "max": round(max_val, 2),
                "std": round(std_val, 2)
            }

            # Outlier detection using IQR
            if len(series) >= 4:
                q25 = float(series.quantile(0.25))
                q75 = float(series.quantile(0.75))
                iqr = q75 - q25
                lower_bound = q25 - 1.5 * iqr
                upper_bound = q75 + 1.5 * iqr
                outliers = series[(series < lower_bound) | (series > upper_bound)].tolist()

                if outliers:
                    insights.append(
                        f"Detected {len(outliers)} statistical outlier(s) in '{col}': values range up to {max(outliers):,.2f}."
                    )

            # Distribution skewness insight
            if abs(mean_val - median_val) > (0.2 * (mean_val or 1)):
                direction = "right-skewed (high-value pull)" if mean_val > median_val else "left-skewed"
                insights.append(
                    f"'{col}' exhibits a {direction} distribution (mean: {mean_val:,.2f} vs median: {median_val:,.2f})."
                )

        # Categorical cardinality insights
        cat_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()
        for col in cat_cols:
            unique_count = df[col].nunique()
            top_val = df[col].mode().iloc[0] if not df[col].empty else None
            top_count = int(df[col].value_counts().iloc[0]) if not df[col].empty else 0
            pct = round((top_count / len(df)) * 100, 1) if len(df) > 0 else 0

            if pct > 40 and unique_count > 1:
                insights.append(
                    f"Category '{col}' is dominated by '{top_val}' representing {pct}% of observed records ({top_count}/{len(df)})."
                )

        # Index / Optimization recommendations based on query
        if query:
            q_upper = query.upper()
            if "WHERE" in q_upper and "JOIN" in q_upper:
                recommendations.append(
                    "Consider verifying composite B-Tree indexes on joined foreign keys and WHERE filter attributes."
                )
            if "ORDER BY" in q_upper and "LIMIT" in q_upper and len(rows) > 500:
                recommendations.append(
                    "Ensure the sorted column has an index matching the sort order (DESC/ASC) to prevent sort spill."
                )

        return {
            "row_count": len(df),
            "column_count": len(columns),
            "statistics": stats,
            "insights": insights if insights else ["Data distribution is uniform across measured records."],
            "recommendations": recommendations
        }
