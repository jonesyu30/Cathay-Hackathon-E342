"""Local Ask Vera API: FastAPI, the MCP Python SDK, PostgreSQL, and Qwen."""

import asyncio
import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib import error, request

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from mcp.server import MCPServer
from pgvector.asyncpg import register_vector
from pydantic import BaseModel

from knowledge import ensure_knowledge_schema, search_chunks

load_dotenv(".env")

SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

pool: asyncpg.Pool | None = None
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "Frontend"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:4b-instruct")
SYSTEM_PROMPT = (
    "You are Vera, Cathay Pacific's AI travel assistant. "
    "Help with flights, baggage, membership, and bookings. "
    "Reply in a few sentences. "
    "The open chat is temporary. "
    "Call save_chat_message only when the user asks you to remember or record a specific note. "
    "For Cathay or HKIA assistance, batteries, medical equipment, animals, or airport facilities, "
    "call search_policy before you answer. "
    "Pass need_groups as acronyms: MOB mobility, VIS visual, HEAR hearing, COG cognitive, "
    "ND neurodivergence, MH mental health, SEN sensory, COM communication, MED medical. "
    "Use GEN only for a general overview or a complaint. "
    "Answer from the passages the tool returns, and include each source URL."
)
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "save_chat_message",
            "description": "Save a note in PostgreSQL and return its id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "role": {
                        "type": "string",
                        "description": "Who the note is from: user or assistant.",
                    },
                    "content": {
                        "type": "string",
                        "description": "The note to save.",
                    },
                },
                "required": ["role", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_policy",
            "description": (
                "Search official Cathay Pacific and HKIA policy text. "
                "Passages are filtered by need group before similarity search. "
                "Each passage includes its source URL."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The policy question, in plain words.",
                    },
                    "need_groups": {
                        "type": "string",
                        "description": (
                            "Comma-separated acronyms. "
                            "MOB mobility, VIS visual, HEAR hearing, COG cognitive, "
                            "ND neurodivergence, MH mental health, SEN sensory, "
                            "COM communication, MED medical. "
                            "GEN is only for a general overview or a complaint."
                        ),
                    },
                },
                "required": ["query", "need_groups"],
            },
        },
    },
]

mcp = MCPServer(
    "Ask Vera",
    instructions="Tools for the Cathay Ask Vera assistant.",
)


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatIn(BaseModel):
    message: str
    history: list[HistoryTurn] = []


async def insert_message(role: str, content: str) -> int:
    if pool is None:
        raise RuntimeError("Database pool is not ready")
    row_id = await pool.fetchval(
        "INSERT INTO chat_messages (role, content) VALUES ($1, $2) RETURNING id",
        role,
        content,
    )
    return int(row_id)


@mcp.tool()
async def save_chat_message(role: str, content: str) -> str:
    """Save a chat message in PostgreSQL and return its id."""
    row_id = await insert_message(role, content)
    return f"Saved message {row_id}"


@mcp.tool()
async def search_policy(query: str, need_groups: str) -> str:
    """Search official policy text after filtering by need group."""
    if pool is None:
        return "Policy search is not ready."
    question = query.strip()
    if not question:
        return "No policy question was given."
    async with pool.acquire() as conn:
        return await search_chunks(conn, question, need_groups)


mcp_app = mcp.streamable_http_app()


async def setup_connection(conn: asyncpg.Connection) -> None:
    await register_vector(conn)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global pool
    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"], init=setup_connection)
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA)
        await ensure_knowledge_schema(conn)
    async with mcp.session_manager.run():
        yield
    await pool.close()
    pool = None


app = FastAPI(title="Ask Vera", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str | int]:
    if pool is None:
        raise RuntimeError("Database pool is not ready")
    value = await pool.fetchval("SELECT 1")
    return {"status": "ok", "database": int(value)}


def parse_arguments(raw: object) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    return {}


def post_ollama(payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = request.Request(
        OLLAMA_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=180) as response:
            return json.loads(response.read().decode())
    except error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        raise HTTPException(status_code=502, detail=f"Ollama returned an error: {detail}") from exc
    except (error.URLError, TimeoutError, OSError) as exc:
        raise HTTPException(status_code=503, detail="Ollama is not reachable") from exc


async def execute_tool(name: str, arguments: dict) -> str:
    if name == "save_chat_message":
        role = str(arguments.get("role") or "user")
        content = str(arguments.get("content") or "").strip()
        if not content:
            return "Nothing was saved because the note was empty."
        row_id = await insert_message(role, content)
        return f"Saved message {row_id}"
    if name == "search_policy":
        return await search_policy(
            str(arguments.get("query") or ""),
            str(arguments.get("need_groups") or ""),
        )
    return f"Unknown tool: {name}"


def working_history(turns: list[HistoryTurn], current: str) -> list[dict[str, str]]:
    history: list[dict[str, str]] = []
    for turn in turns[-8:]:
        content = turn.content.strip()[:2000]
        if content:
            history.append({"role": turn.role, "content": content})
    history.append({"role": "user", "content": current[:2000]})
    return history


async def ask_qwen(history: list[dict[str, str]]) -> tuple[str, list[str]]:
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}, *history]
    used: list[str] = []
    for _ in range(3):
        body = await asyncio.to_thread(
            post_ollama,
            {
                "model": OLLAMA_MODEL,
                "messages": messages,
                "tools": TOOLS,
                "stream": False,
                "think": False,
            },
        )
        message = body.get("message") or {}
        tool_calls = message.get("tool_calls") or []
        messages.append(
            {
                "role": "assistant",
                "content": message.get("content") or "",
                "tool_calls": tool_calls,
            }
        )
        if not tool_calls:
            content = (message.get("content") or "").strip()
            if not content:
                content = "I could not produce a reply. Please try again."
            return content, used
        for call in tool_calls:
            function = call.get("function") or {}
            name = str(function.get("name") or "")
            result = await execute_tool(name, parse_arguments(function.get("arguments")))
            used.append(name)
            messages.append({"role": "tool", "tool_name": name, "content": result})
    raise HTTPException(status_code=502, detail="The model called tools too many times")


@app.post("/api/chat")
async def chat(body: ChatIn) -> dict[str, str | list[str]]:
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message is empty")
    reply, tools_used = await ask_qwen(working_history(body.history, text))
    return {"reply": reply, "tools_used": tools_used}


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/style.css")
async def styles() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "style.css")


@app.get("/main.js")
async def script() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "main.js")


app.mount("/", mcp_app)
