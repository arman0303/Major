import io
import json
import csv
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Dict, Any, List, Optional, Tuple
import pandas as pd
from pypdf import PdfReader

class DataParser:
    """
    Parses and profiles JSON, CSV, and PDF datasets.
    Infers SQL column types, handles missing values, detects keys and relationships.
    Also provides text chunking for RAG indexing.
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

        # Generate chunks with page metadata for RAG
        chunks = DataParser.chunk_pdf_pages(pages_text, filename)

        return {
            "file_name": filename,
            "page_count": len(reader.pages),
            "text_content": full_text,
            "pages": pages_text,
            "extracted_tables": tables_extracted,
            "is_structured": len(tables_extracted) > 0,
            "chunks": chunks,
        }

    @classmethod
    def parse_docx(cls, file_content: bytes, filename: str) -> Dict[str, Any]:
        """Extracts text and generates chunks from DOCX Word documents."""
        try:
            with zipfile.ZipFile(io.BytesIO(file_content)) as z:
                xml_content = z.read("word/document.xml")
                tree = ET.fromstring(xml_content)
                ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
                paragraphs = []
                for p in tree.iterfind(".//w:p", ns):
                    texts = [node.text for node in p.iterfind(".//w:t", ns) if node.text]
                    if texts:
                        paragraphs.append("".join(texts))
                full_text = "\n\n".join(paragraphs)
                chunks = cls.chunk_text(full_text, filename)
                return {
                    "file_name": filename,
                    "page_count": max(1, len(paragraphs) // 15),
                    "text_content": full_text,
                    "paragraphs": paragraphs,
                    "is_structured": False,
                    "chunks": chunks,
                }
        except Exception as e:
            raise ValueError(f"Failed to parse DOCX file: {str(e)}")

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

    @staticmethod
    def chunk_pdf_pages(
        pages_text: List[Dict[str, Any]],
        source_name: str,
        chunk_size: int = 800,
        chunk_overlap: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Split PDF pages into overlapping text chunks for RAG indexing.
        Each chunk includes page number and source metadata.
        """
        chunks = []
        chunk_idx = 0

        for page_info in pages_text:
            page_num = page_info["page"]
            text = page_info["text"]

            if not text.strip():
                continue

            # Split page into sub-chunks if it's long
            if len(text) <= chunk_size:
                chunks.append({
                    "content": text,
                    "metadata": {
                        "source": source_name,
                        "page_number": page_num,
                        "chunk_index": chunk_idx,
                    },
                })
                chunk_idx += 1
            else:
                start = 0
                while start < len(text):
                    end = min(start + chunk_size, len(text))
                    # Try to break at sentence boundary
                    if end < len(text):
                        for sep in [". ", ".\n", "\n\n", "\n"]:
                            idx = text.rfind(sep, start + chunk_size // 2, end)
                            if idx != -1:
                                end = idx + len(sep)
                                break
                    chunk_text = text[start:end].strip()
                    if chunk_text:
                        chunks.append({
                            "content": chunk_text,
                            "metadata": {
                                "source": source_name,
                                "page_number": page_num,
                                "chunk_index": chunk_idx,
                            },
                        })
                        chunk_idx += 1
                    start = max(start + 1, end - chunk_overlap)

        return chunks

    @staticmethod
    def chunk_text(
        text: str,
        source_name: str,
        chunk_size: int = 800,
        chunk_overlap: int = 100,
    ) -> List[Dict[str, Any]]:
        """Split plain text into chunks for RAG indexing."""
        chunks = []
        start = 0
        chunk_idx = 0

        while start < len(text):
            end = min(start + chunk_size, len(text))
            if end < len(text):
                for sep in ["\n\n", "\n", ". ", " "]:
                    idx = text.rfind(sep, start + chunk_size // 2, end)
                    if idx != -1:
                        end = idx + len(sep)
                        break
            chunk_text = text[start:end].strip()
            if chunk_text:
                chunks.append({
                    "content": chunk_text,
                    "metadata": {
                        "source": source_name,
                        "chunk_index": chunk_idx,
                    },
                })
                chunk_idx += 1
            start = max(start + 1, end - chunk_overlap)

        return chunks
