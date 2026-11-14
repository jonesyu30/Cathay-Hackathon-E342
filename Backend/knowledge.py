"""Official Cathay and HKIA policy chunks, stored for pgvector search."""

import asyncio
import json
import os
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib import error, request

from dotenv import load_dotenv
from pgvector.asyncpg import register_vector

load_dotenv(".env")

EMBED_DIM = 768
INFO_PATH = Path(__file__).resolve().parents[2] / "Cathay Info.xlsx"
SPECIFIC_GROUPS = {"MOB", "VIS", "HEAR", "COG", "ND", "MH", "SEN", "COM", "MED"}
GROUP_HELP = "MOB, VIS, HEAR, COG, ND, MH, SEN, COM, MED, or GEN"

KNOWLEDGE_STATEMENTS = (
    f"""
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
        chunk_id TEXT PRIMARY KEY,
        organization TEXT NOT NULL,
        document_title TEXT NOT NULL,
        heading TEXT NOT NULL,
        need_groups TEXT[] NOT NULL,
        chunk_text TEXT NOT NULL,
        source_url TEXT NOT NULL,
        embedding vector({EMBED_DIM}) NOT NULL
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS knowledge_chunks_groups_idx
        ON knowledge_chunks USING gin (need_groups)
    """,
    """
    CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
        ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
    """,
)


async def ensure_knowledge_schema(conn) -> None:
    for statement in KNOWLEDGE_STATEMENTS:
        await conn.execute(statement)

_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def embed_url() -> str:
    chat = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
    if chat.endswith("/api/chat"):
        return chat[: -len("/api/chat")] + "/api/embed"
    return "http://127.0.0.1:11434/api/embed"


def embed_model() -> str:
    return os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")


def _column_index(cell_ref: str) -> int:
    letters = "".join(char for char in cell_ref if char.isalpha())
    index = 0
    for char in letters:
        index = index * 26 + ord(char.upper()) - 64
    return index - 1


def _cell_text(cell: ET.Element) -> str:
    inline = cell.find(f"{{{_NS}}}is")
    if inline is not None:
        return "".join(node.text or "" for node in inline.iter(f"{{{_NS}}}t"))
    value = cell.find(f"{{{_NS}}}v")
    return value.text if value is not None and value.text else ""


def _chunks_sheet(book: zipfile.ZipFile) -> str:
    package = "http://schemas.openxmlformats.org/package/2006/relationships"
    office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    workbook = ET.fromstring(book.read("xl/workbook.xml"))
    relations = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    targets = {
        item.attrib["Id"]: item.attrib["Target"]
        for item in relations.findall(f"{{{package}}}Relationship")
    }
    for sheet in workbook.findall(f"{{{_NS}}}sheets/{{{_NS}}}sheet"):
        if sheet.attrib.get("name") == "Chunks":
            target = targets[sheet.attrib[f"{{{office}}}id"]].lstrip("/")
            return target if target.startswith("xl/") else "xl/" + target
    raise RuntimeError("Cathay Info.xlsx has no Chunks sheet")


def read_chunks(path: Path = INFO_PATH) -> list[dict]:
    """Read the RAG chunks. The Acronyms sheet and the catalog workbook are left out."""
    columns = (
        "chunk_id",
        "organization",
        "document_title",
        "heading",
        "need_groups",
        "chunk_text",
        "source_url",
    )
    with zipfile.ZipFile(path) as book:
        root = ET.fromstring(book.read(_chunks_sheet(book)))
    rows = root.findall(f"{{{_NS}}}sheetData/{{{_NS}}}row")
    header = [_cell_text(cell) for cell in rows[0].findall(f"{{{_NS}}}c")]
    if header[: len(columns)] != list(columns):
        raise RuntimeError(f"Unexpected chunk columns: {header}")
    chunks = []
    for row in rows[1:]:
        values = [""] * len(columns)
        for cell in row.findall(f"{{{_NS}}}c"):
            index = _column_index(cell.attrib.get("r", ""))
            if index < len(columns):
                values[index] = _cell_text(cell).strip()
        if not values[0]:
            continue
        groups = [part.strip() for part in values[4].split(",") if part.strip()]
        if not groups or not values[5] or not values[6]:
            raise RuntimeError(f"{values[0]} is missing groups, text, or a source URL")
        chunks.append(
            {
                "chunk_id": values[0],
                "organization": values[1],
                "document_title": values[2],
                "heading": values[3],
                "need_groups": groups,
                "chunk_text": values[5],
                "source_url": values[6],
            }
        )
    return chunks


def embed_texts(texts: list[str], *, query: bool) -> list[list[float]]:
    prefix = "search_query: " if query else "search_document: "
    payload = json.dumps(
        {"model": embed_model(), "input": [prefix + text for text in texts]}
    ).encode()
    req = request.Request(
        embed_url(),
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=120) as response:
            body = json.loads(response.read().decode())
    except error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise RuntimeError(f"Embedding model returned an error: {detail}") from exc
    except (error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError("Embedding model is not reachable") from exc
    vectors = body.get("embeddings") or []
    if len(vectors) != len(texts):
        raise RuntimeError("Embedding model returned the wrong number of vectors")
    for vector in vectors:
        if len(vector) != EMBED_DIM:
            raise RuntimeError(f"Expected {EMBED_DIM} dimensions, got {len(vector)}")
    return vectors


def groups_for_filter(raw: str) -> tuple[list[str], str | None]:
    tokens = [part.strip().upper() for part in raw.replace(";", ",").split(",") if part.strip()]
    specific: list[str] = []
    wants_general = False
    unknown: list[str] = []
    for token in tokens:
        if token == "GEN":
            wants_general = True
        elif token in SPECIFIC_GROUPS and token not in specific:
            specific.append(token)
        elif token not in unknown:
            unknown.append(token)
    if specific:
        return specific, None
    if wants_general:
        return ["GEN"], None
    if unknown:
        return [], f"Unknown need group: {', '.join(unknown)}. Use {GROUP_HELP}."
    return [], f"No need group was given. Use {GROUP_HELP}."


async def search_chunks(conn, query: str, need_groups: str) -> str:
    """Filter official passages by need group, then rank them by similarity."""
    groups, problem = groups_for_filter(need_groups)
    if problem:
        return problem
    try:
        vector = (await asyncio.to_thread(embed_texts, [query], query=True))[0]
    except RuntimeError as exc:
        return str(exc)
    rows = await conn.fetch(
        """
        SELECT chunk_id, heading, need_groups, chunk_text, source_url
        FROM knowledge_chunks
        WHERE need_groups && $2::text[]
        ORDER BY embedding <=> $1
        LIMIT 3
        """,
        vector,
        groups,
    )
    if not rows:
        return f"No official passage is stored for {', '.join(groups)}."
    parts = []
    for row in rows:
        labels = ", ".join(row["need_groups"])
        parts.append(
            f"{row['chunk_id']} | {row['heading']} | {labels}\n"
            f"Source: {row['source_url']}\n"
            f"{row['chunk_text']}"
        )
    return "\n\n".join(parts)


async def load_chunks() -> int:
    import asyncpg

    chunks = read_chunks()
    passages = [f"{chunk['heading']}\n{chunk['chunk_text']}" for chunk in chunks]
    vectors = []
    for start in range(0, len(passages), 16):
        vectors.extend(await asyncio.to_thread(embed_texts, passages[start : start + 16], query=False))
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        await register_vector(conn)
        await conn.execute("DROP TABLE IF EXISTS knowledge_chunks")
        await ensure_knowledge_schema(conn)
        await conn.executemany(
            """
            INSERT INTO knowledge_chunks (
                chunk_id, organization, document_title, heading,
                need_groups, chunk_text, source_url, embedding
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            [
                (
                    chunk["chunk_id"],
                    chunk["organization"],
                    chunk["document_title"],
                    chunk["heading"],
                    chunk["need_groups"],
                    chunk["chunk_text"],
                    chunk["source_url"],
                    vector,
                )
                for chunk, vector in zip(chunks, vectors)
            ],
        )
    finally:
        await conn.close()
    return len(chunks)


if __name__ == "__main__":
    count = asyncio.run(load_chunks())
    print(f"Loaded {count} policy chunks")
