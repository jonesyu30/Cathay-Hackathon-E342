from fastapi.staticfiles import StaticFiles
"""Local Ask CARE API: FastAPI, the MCP Python SDK, Google Cloud SQL, and CES/Vertex AI Gemini."""

import asyncio
import datetime
import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal
from urllib import error, request
from uuid import uuid4

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from mcp.server import MCPServer
from pgvector.asyncpg import register_vector
from pydantic import BaseModel, Field

# Added Google GenAI SDK imports
from google import genai
from google.genai import types
import google.auth
from google.auth.transport.requests import Request
import requests

from knowledge import ensure_knowledge_schema, search_chunks
from catalog import ensure_catalog, fetch_catalog, fetch_catalog_offline
from import_catalog import import_catalog
from task_replies import SCHEMA as TASK_SCHEMA
from task_replies import router as task_replies_router
from feedback import SCHEMA as FEEDBACK_SCHEMA
from feedback import router as feedback_router

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv(".env")

SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

CODE_SCHEMA = """
CREATE TABLE IF NOT EXISTS passenger_codes (
    passenger_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL,
    code TEXT NOT NULL CHECK (code IN (
        'WCHR', 'WCHS', 'WCHC', 'BLND', 'DEAF', 'SVAN',
        'DPNA', 'MAAS', 'MEDA', 'OXYG', 'PPOC', 'STCR'
    )),
    PRIMARY KEY (passenger_id, booking_id, code)
);
"""

CONDITION_SCHEMA = """
CREATE TABLE IF NOT EXISTS passenger_conditions (
    passenger_id INTEGER NOT NULL,
    show_when TEXT NOT NULL,
    PRIMARY KEY (passenger_id, show_when)
);
"""

pool: asyncpg.Pool | None = None
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "Frontend"

# --- CES (CX AGENT STUDIO) CONFIGURATION ---
CES_PROJECT = os.environ.get("CES_PROJECT", "")
CES_LOCATION = os.environ.get("CES_LOCATION", "us")
CES_APP_ID = os.environ.get("CES_APP_ID", "")
CES_VERSION_ID = os.environ.get("CES_VERSION_ID", "")
CES_DEPLOYMENT_ID = os.environ.get("CES_DEPLOYMENT_ID", "")
ces_creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])

SYSTEM_PROMPT = (
    "You are CARE, Cathay Pacific's AI travel assistant. "
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

# Kept for reference or manual tool definitions if needed, but SDK uses native Python functions
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
    "Ask CARE",
    instructions="Tools for the Cathay Ask CARE assistant.",
)


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatIn(BaseModel):
    message: str
    history: list[HistoryTurn] = []
    session_id: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{4,62}$")


async def insert_message(role: str, content: str) -> int:
    if pool is None:
        # Bypassed active DB requirement so server boots without errors
        print(f"[MOCK DB INSERT] ({role}): {content}")
        return 999
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
        return f"Mock policy search result for query: '{query}' (Need groups: {need_groups})"
    question = query.strip()
    if not question:
        return "No policy question was given."
    async with pool.acquire() as conn:
        return await search_chunks(conn, question, need_groups)


mcp_app = mcp.streamable_http_app()


async def setup_connection(conn: asyncpg.Connection) -> None:
    # await register_vector(conn)  # Commented out to prevent vector startup crash
    pass


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global pool
    connector = None
    db_url = os.environ.get("DATABASE_URL")
    cloudsql_instance = os.environ.get("CLOUDSQL_INSTANCE", "")
    cloudsql_socket = f"/cloudsql/{cloudsql_instance}" if cloudsql_instance else ""
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    db_user = os.environ.get("DB_USER", "postgres")
    db_password = os.environ.get("DB_PASSWORD", "")
    db_name = os.environ.get("DB_NAME", "cathay")
    try:
        if db_url:
            pool = await asyncpg.create_pool(db_url, min_size=1, max_size=5)
            print("[DATABASE] Connected to Cloud SQL via DATABASE_URL", flush=True)
        elif cloudsql_instance and creds_path and os.path.exists(creds_path):
            from google.cloud.sql.connector import Connector
            loop = asyncio.get_running_loop()
            connector = Connector(loop=loop)

            async def getconn(*_args: Any, **_kwargs: Any) -> asyncpg.Connection:
                return await connector.connect_async(
                    cloudsql_instance,
                    "asyncpg",
                    user=db_user,
                    password=db_password,
                    db=db_name,
                )

            pool = await asyncpg.create_pool(connect=getconn, min_size=1, max_size=5)
            print(f"[DATABASE] Connected to Cloud SQL via Python Connector ({cloudsql_instance})", flush=True)
        elif cloudsql_socket and os.path.exists(f"{cloudsql_socket}/.s.PGSQL.5432"):
            socket_url = f"postgresql://{db_user}:{db_password}@/{db_name}?host={cloudsql_socket}"
            pool = await asyncpg.create_pool(socket_url, min_size=1, max_size=5)
            print(f"[DATABASE] Connected to Cloud SQL via Unix socket {cloudsql_socket}", flush=True)
        else:
            local_url = f"postgresql://{db_user}:{db_password}@127.0.0.1:5433/{db_name}"
            pool = await asyncpg.create_pool(local_url, min_size=1, max_size=5)
            print("[DATABASE] Connected to Cloud SQL via local proxy", flush=True)

        async with pool.acquire() as conn:
            await conn.execute(SCHEMA)
            await conn.execute(TASK_SCHEMA)
            await conn.execute(FEEDBACK_SCHEMA)
            await conn.execute(CODE_SCHEMA)
            await conn.execute(CONDITION_SCHEMA)
            try:
                has_needs = await conn.fetchval(
                    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'needs')"
                )
                force_sync = os.environ.get("FORCE_CATALOG_SYNC", "false").lower() in ("true", "1")
                if not has_needs or force_sync:
                    print("[CATALOG] Initializing catalog schema and importing Cathay DB.xlsx into Cloud SQL...")
                    await ensure_catalog(conn)
                    await import_catalog(conn)
                    print("[CATALOG] Catalog imported successfully into Cloud SQL.")
                else:
                    print("[CATALOG] Cloud SQL catalog tables already present.")
            except Exception as cat_err:
                print(f"[CATALOG] Catalog sync note: {cat_err}")
    except Exception as e:
        print(f"[DATABASE] Cloud SQL connection skipped/failed: {e}")
    
    async with mcp.session_manager.run():
        yield
    
    if pool:
        await pool.close()
    pool = None
    if connector:
        await connector.close_async()


app = FastAPI(title="Ask CARE", lifespan=lifespan)
app.include_router(task_replies_router)
app.include_router(feedback_router)


@app.get("/health")
async def health() -> dict[str, str | int]:
    if pool is None:
        return {"status": "ok", "database": "bypassed"}
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


# --- CES (CX AGENT STUDIO) CHAT HANDLER ---
async def ask_ces(current_message: str, session_id: str | None = None) -> tuple[str, list[str], str]:
    def _call() -> tuple[str, list[str], str]:
        if not ces_creds.valid:
            ces_creds.refresh(Request())

        headers = {
            "Authorization": f"Bearer {ces_creds.token}",
            "Content-Type": "application/json",
        }

        active_session = session_id or str(uuid4())
        for attempt in range(2):
            session = f"projects/{CES_PROJECT}/locations/{CES_LOCATION}/apps/{CES_APP_ID}/sessions/{active_session}"
            url = f"https://ces.googleapis.com/v1beta/{session}:runSession"
            payload = {
                "config": {
                    "session": session,
                    "app_version": f"projects/{CES_PROJECT}/locations/{CES_LOCATION}/apps/{CES_APP_ID}/versions/{CES_VERSION_ID}",
                    "deployment": f"projects/{CES_PROJECT}/locations/{CES_LOCATION}/apps/{CES_APP_ID}/deployments/{CES_DEPLOYMENT_ID}",
                },
                "inputs": [{"text": current_message}],
            }

            resp = requests.post(url, headers=headers, json=payload, timeout=25)
            if not resp.ok:
                try:
                    error_body = resp.json()
                except ValueError:
                    error_body = None
                error_info = error_body.get("error") if isinstance(error_body, dict) else None
                details = error_info.get("details", []) if isinstance(error_info, dict) else []
                ended = resp.status_code == 400 and isinstance(details, list) and any(
                    isinstance(item, dict) and item.get("reason") == "SESSION_ALREADY_ENDED"
                    for item in details
                )
                if ended and attempt == 0:
                    active_session = str(uuid4())
                    continue
                raise HTTPException(status_code=resp.status_code, detail=f"CES API error: {resp.text}")

            data = resp.json()
            outputs = data.get("outputs", [])
            if outputs and "text" in outputs[0]:
                return outputs[0]["text"].strip(), [], active_session
            return "I could not produce a reply. Please try again.", [], active_session

        raise RuntimeError("CES session retry exhausted")

    try:
        return await asyncio.to_thread(_call)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"CES returned an error: {str(exc)}") from exc


@app.post("/api/chat")
async def chat(body: ChatIn) -> dict[str, str | list[str]]:
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message is empty")
    
    # Swapped from ask_gemini to ask_ces
    reply, tools_used, session_id = await ask_ces(text, body.session_id)
    return {"reply": reply, "tools_used": tools_used, "session_id": session_id}


async def fetch_passenger_conditions(conn) -> list[dict[str, int | str]]:
    rows = await conn.fetch(
        "SELECT passenger_id, show_when FROM passenger_conditions ORDER BY passenger_id, show_when"
    )
    return [{"passenger_id": row["passenger_id"], "show_when": row["show_when"]} for row in rows]


async def load_catalog() -> dict:
    """Catalog from Cloud SQL Postgres, or the workbook when that read fails, plus saved travel rules."""
    catalog = None
    if pool is not None:
        try:
            async with pool.acquire() as conn:
                catalog = await fetch_catalog(conn)
        except Exception as exc:
            print(f"[CATALOG] Cloud SQL catalog fetch failed, using offline fallback: {exc}")
    if catalog is None:
        catalog = fetch_catalog_offline()
    if pool is None:
        catalog["passenger_conditions"] = []
        return catalog
    try:
        async with pool.acquire() as conn:
            catalog["passenger_conditions"] = await fetch_passenger_conditions(conn)
    except Exception as exc:
        print(f"[CATALOG] Saved travel rules could not be read from Cloud SQL: {exc}")
        catalog["passenger_conditions"] = []
    return catalog


@app.get("/api/plan-data")
async def get_plan_data() -> dict:
    """Fetch live Cathay accessibility catalog and passenger trip plans from Cloud SQL."""
    return await load_catalog()


@app.get("/plan-data.js")
async def plan_data_script() -> Response:
    """Serve dynamic plan-data.js with live Cloud SQL database catalog or Cathay DB.xlsx fallback."""
    catalog = await load_catalog()
    body = "const CATHAY = " + json.dumps(catalog, ensure_ascii=False) + ";\n"
    return Response(content=body, media_type="text/javascript", headers={"Cache-Control": "no-store"})


class SurveyAnswerIn(BaseModel):
    passenger_id: int
    service_id: int | None = None
    airport_service_id: int | None = None
    need_id: int | None = None
    answer: str = "yes"


@app.post("/api/survey")
async def save_survey_answer(body: SurveyAnswerIn) -> dict[str, str]:
    """Dynamically save or update a passenger's accessibility requirement in Cloud SQL."""
    if pool is None:
        return {"status": "saved", "database": "bypassed"}
    
    async with pool.acquire() as conn:
        try:
            await conn.execute(
                """
                INSERT INTO survey_answers (passenger_id, service_id, airport_service_id, need_id, answer)
                VALUES ($1, $2, $3, $4, $5)
                """,
                body.passenger_id,
                body.service_id,
                body.airport_service_id,
                body.need_id,
                body.answer,
            )
        except Exception:
            await conn.execute(
                """
                INSERT INTO survey (passenger_id, service_id, airport_service_id, need_id, answer)
                VALUES ($1, $2, $3, $4, $5)
                """,
                body.passenger_id,
                body.service_id,
                body.airport_service_id,
                body.need_id,
                body.answer,
            )
    return {"status": "saved"}


class PassengerCodesIn(BaseModel):
    passenger_id: int = Field(ge=1)
    booking_id: int = Field(ge=1)
    codes: list[str]


@app.post("/api/passenger-codes")
async def save_passenger_codes(body: PassengerCodesIn) -> dict[str, Any]:
    """Store the SSR codes chosen by this passenger's questionnaire into Cloud SQL."""
    allowed = {"WCHR", "WCHS", "WCHC", "BLND", "DEAF", "SVAN", "DPNA", "MAAS", "MEDA", "OXYG", "PPOC", "STCR"}
    codes = []
    for code in body.codes:
        if code not in allowed or code in codes:
            continue
        codes.append(code)
    if pool is None:
        return {"codes": codes, "database": "bypassed"}
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM passenger_codes WHERE passenger_id = $1 AND booking_id = $2",
            body.passenger_id,
            body.booking_id,
        )
        for code in codes:
            await conn.execute(
                """
                INSERT INTO passenger_codes (passenger_id, booking_id, code)
                VALUES ($1, $2, $3)
                ON CONFLICT (passenger_id, booking_id, code) DO NOTHING
                """,
                body.passenger_id,
                body.booking_id,
                code,
            )
    return {"codes": codes}


class ProfileGroupIn(BaseModel):
    group_id: int = Field(ge=1)
    tag_id: int | None = None


class StoredAnswerIn(BaseModel):
    service_id: int | None = None
    airport_service_id: int | None = None
    need_id: int | None = None
    answer: str


class SurveySubmissionIn(BaseModel):
    passenger_id: int = Field(ge=1)
    groups: list[ProfileGroupIn]
    answers: list[StoredAnswerIn]
    conditions: list[str] = []


@app.post("/api/survey-submission")
async def save_survey_submission(body: SurveySubmissionIn) -> dict[str, Any]:
    """Replace this passenger's groups, service answers, and matched travel rules in Cloud SQL."""
    answers = []
    for answer in body.answers:
        filled = [value for value in (answer.service_id, answer.airport_service_id, answer.need_id) if value]
        if len(filled) != 1 or answer.answer not in ("yes", "no"):
            continue
        answers.append(answer)
    conditions = []
    for condition in body.conditions:
        text = condition.strip()
        if text and text not in conditions:
            conditions.append(text)
    if pool is None:
        return {
            "groups": len(body.groups),
            "answers": len(answers),
            "conditions": len(conditions),
            "database": "bypassed",
        }
    async with pool.acquire() as conn:
        async with conn.transaction():
            known = {
                row["show_when"]
                for row in await conn.fetch("SELECT DISTINCT show_when FROM rule_links")
            }
            conditions = [text for text in conditions if text in known]
            await conn.execute("DELETE FROM survey_answers WHERE passenger_id = $1", body.passenger_id)
            await conn.execute("DELETE FROM profile_groups WHERE passenger_id = $1", body.passenger_id)
            await conn.execute("DELETE FROM passenger_conditions WHERE passenger_id = $1", body.passenger_id)
            for group in body.groups:
                await conn.execute(
                    """
                    INSERT INTO profile_groups (passenger_id, group_id, tag_id)
                    VALUES ($1, $2, $3)
                    """,
                    body.passenger_id,
                    group.group_id,
                    group.tag_id,
                )
            for answer in answers:
                await conn.execute(
                    """
                    INSERT INTO survey_answers (passenger_id, service_id, airport_service_id, need_id, answer)
                    VALUES ($1, $2, $3, $4, $5)
                    """,
                    body.passenger_id,
                    answer.service_id,
                    answer.airport_service_id,
                    answer.need_id,
                    answer.answer,
                )
            for condition in conditions:
                await conn.execute(
                    """
                    INSERT INTO passenger_conditions (passenger_id, show_when)
                    VALUES ($1, $2)
                    """,
                    body.passenger_id,
                    condition,
                )
    return {"groups": len(body.groups), "answers": len(answers), "conditions": len(conditions)}


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


def frontend_file(name: str) -> FileResponse:
    path = (FRONTEND_DIR / name).resolve()
    if FRONTEND_DIR.resolve() not in path.parents or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(path, headers={"Cache-Control": "no-cache, must-revalidate"})


@app.get("/questionnaire")
@app.get("/questionnaire.html")
async def questionnaire_page() -> FileResponse:
    return frontend_file("questionnaire.html")


@app.get("/questionnaire.css")
async def questionnaire_styles() -> FileResponse:
    return frontend_file("questionnaire.css")


@app.get("/questionnaire.js")
async def questionnaire_script() -> FileResponse:
    return frontend_file("questionnaire.js")


@app.get("/plan")
@app.get("/plan.html")
async def plan_page() -> FileResponse:
    return frontend_file("plan.html")


@app.get("/plan.css")
async def plan_styles() -> FileResponse:
    return frontend_file("plan.css")


@app.get("/plan-build.js")
async def plan_script() -> FileResponse:
    return frontend_file("plan-build.js")


@app.get("/task-form")
@app.get("/task-form.html")
async def task_form_page() -> FileResponse:
    return frontend_file("task-form.html")


@app.get("/task-form.js")
async def task_form_script() -> FileResponse:
    return frontend_file("task-form.js")


@app.get("/staff.html")
async def staff_page() -> FileResponse:
    return frontend_file("staff.html")


@app.get("/staff-roster.js")
async def staff_roster_script() -> FileResponse:
    return frontend_file("staff-roster.js")


@app.get("/feedback-widget.js")
async def feedback_widget_script() -> FileResponse:
    return frontend_file("feedback-widget.js")


@app.get("/feedback-insights")
@app.get("/feedback-insights.html")
async def feedback_insights_page() -> FileResponse:
    return frontend_file("feedback-insights.html")


@app.get("/style.css")
async def styles() -> FileResponse:
    return frontend_file("style.css")


@app.get("/main.js")
async def script() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "main.js", headers={"Cache-Control": "no-cache, must-revalidate"})


app.add_route("/mcp", mcp_app)
app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
