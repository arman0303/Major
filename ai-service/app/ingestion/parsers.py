import io
import json
import csv
from typing import Dict, Any, List, Tuple
import pandas as pd
from pypdf import PdfReader

class DataParser:
    """
    Parses and profiles JSON, CSV, and PDF datasets.
    Infers SQL column types, handles missing values, detects keys and relationships.
    """

    @classmethod
    def parse_csv(cls, file_content: bytes, filename: str) -> Dict[str, Any]:
        """Parses CSV bytes and returns DataFrame, schema info, and preview rows."""
        text = file_content.decode("utf-8", errors="replace")
        # Detect delimiter
        sniffer = csv.Sniffer()
        try:
            sample = text[:4096]
            dialect = sniffer.sniff(sample)
            delimiter = dialect.delimiter
        except Exception:
            delimiter = ","

        df = pd.read_csv(io.StringIO(text), delimiter=delimiter)
        return cls._profile_dataframe(df, filename)

    @classmethod
    def parse_json(cls, file_content: bytes, filename: str) -> Dict[str, Any]:
        """Parses JSON bytes (array of objects or nested objects) into tabular format."""
        data = json.loads(file_content.decode("utf-8", errors="replace"))
        if isinstance(data, list):
            df = pd.json_normalize(data)
        elif isinstance(data, dict):
            # If dictionary has a key that contains a list of records
            found_list = None
            for k, v in data.items():
                if isinstance(v, list) and v and isinstance(v[0], dict):
                    found_list = v
                    break
            if found_list:
                df = pd.json_normalize(found_list)
            else:
                df = pd.json_normalize([data])
        else:
            raise ValueError("Unsupported JSON format. Expected list of records or JSON object.")

        return cls._profile_dataframe(df, filename)

    @classmethod
    def parse_pdf(cls, file_content: bytes, filename: str) -> Dict[str, Any]:
        """Extracts text and structured tables from PDF files."""
        reader = PdfReader(io.BytesIO(file_content))
        pages_text = []
        for i, page in enumerate(reader.pages):
            txt = page.extract_text() or ""
            pages_text.append({"page": i + 1, "text": txt.strip()})

        full_text = "\n\n".join(p["text"] for p in pages_text)

        # Attempt table extraction if pdfplumber is present
        tables_extracted = []
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(file_content)) as pdf:
                for i, page in enumerate(pdf.pages):
                    page_tables = page.extract_tables()
                    for t in page_tables:
                        if t and len(t) > 1:
                            tables_extracted.append({"page": i + 1, "data": t})
        except Exception:
            pass

        return {
            "file_name": filename,
            "page_count": len(reader.pages),
            "text_content": full_text,
            "pages": pages_text,
            "extracted_tables": tables_extracted,
            "is_structured": len(tables_extracted) > 0
        }

    @classmethod
    def _profile_dataframe(cls, df: pd.DataFrame, filename: str) -> Dict[str, Any]:
        # Clean column names for PostgreSQL compatibility
        clean_cols = []
        for c in df.columns:
            clean = str(c).strip().lower().replace(" ", "_").replace("-", "_")
            clean = "".join(ch for ch in clean if ch.isalnum() or ch == "_")
            if clean and clean[0].isdigit():
                clean = f"col_{clean}"
            clean_cols.append(clean or "unnamed_col")

        df.columns = clean_cols

        columns_meta = []
        for col in df.columns:
            series = df[col]
            sql_type = cls._infer_postgres_type(series)
            is_pk = (series.is_unique and series.notnull().all() and len(df) > 0)
            sample_vals = series.dropna().head(3).tolist()

            columns_meta.append({
                "name": col,
                "type": sql_type,
                "is_primary_key": is_pk,
                "is_foreign_key": col.endswith("_id") and not is_pk,
                "nullable": bool(series.isnull().any()),
                "sample_values": sample_vals
            })

        preview_rows = df.head(10).fillna("").to_dict(orient="records")

        return {
            "file_name": filename,
            "row_count": len(df),
            "columns": columns_meta,
            "preview": preview_rows,
            "column_names": clean_cols
        }

    @staticmethod
    def _infer_postgres_type(series: pd.Series) -> str:
        s_clean = series.dropna()
        if len(s_clean) == 0:
            return "VARCHAR(255)"

        if pd.api.types.is_bool_dtype(s_clean):
            return "BOOLEAN"
        elif pd.api.types.is_integer_dtype(s_clean):
            return "BIGINT" if s_clean.max() > 2147483647 else "INTEGER"
        elif pd.api.types.is_float_dtype(s_clean):
            return "NUMERIC(14, 2)"
        elif pd.api.types.is_datetime64_any_dtype(s_clean):
            return "TIMESTAMP WITH TIME ZONE"
        else:
            # Check string dates
            sample = str(s_clean.iloc[0])
            if len(sample) == 10 and sample.count("-") == 2:
                return "DATE"
            return "VARCHAR(255)" if s_clean.astype(str).str.len().max() <= 255 else "TEXT"
