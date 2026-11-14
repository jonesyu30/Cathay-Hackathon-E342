"""Stores answers the passenger types on a trip-plan task."""

import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# Cathay conditions of contract: arrive at least two hours before departure.
MIN_HOURS_BEFORE = 2
HONG_KONG = timezone(timedelta(hours=8))

SCHEMA = """
CREATE TABLE IF NOT EXISTS task_replies (
    passenger_id INTEGER NOT NULL CHECK (passenger_id BETWEEN 1 AND 4),
    task_key TEXT NOT NULL CHECK (char_length(task_key) BETWEEN 1 AND 200),
    answer TEXT NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 40),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (passenger_id, task_key)
);
"""

TIME_ANSWER = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
router = APIRouter()


class ReplyIn(BaseModel):
    passenger_id: int = Field(ge=1, le=4)
    task_key: str = Field(min_length=1, max_length=200)
    reply: Literal["time", "yesno"]
    answer: str = Field(min_length=1, max_length=40)


def database():
    import main

    if main.pool is None:
        raise HTTPException(status_code=503, detail="Database is not ready")
    return main.pool


def require_early_arrival(departs_at: str, hhmm: str) -> None:
    departs = datetime.strptime(departs_at, "%Y-%m-%d %H:%M").replace(tzinfo=HONG_KONG)
    hour, minute = int(hhmm[:2]), int(hhmm[3:5])
    arrival = departs.replace(hour=hour, minute=minute)
    latest = departs - timedelta(hours=MIN_HOURS_BEFORE)
    if arrival > latest:
        raise HTTPException(
            status_code=400,
            detail=f"Arrive at least 2 hours before departure. The latest time is {latest.strftime('%H:%M')}.",
        )


async def departs_for(passenger_id: int) -> str:
    row = await database().fetchrow(
        """
        SELECT departs_at
        FROM bookings
        WHERE passenger_id = $1
        ORDER BY departs_at
        LIMIT 1
        """,
        passenger_id,
    )
    if row is None:
        raise HTTPException(status_code=400, detail="This passenger has no flight")
    return row["departs_at"]


def clean_answer(reply: str, answer: str) -> str:
    value = answer.strip()
    if reply == "time":
        if len(value) == 8 and value[5] == ":":
            value = value[:5]
        if not TIME_ANSWER.match(value):
            raise HTTPException(status_code=400, detail="Enter the time as HH:MM")
        return value
    if value.lower() not in {"yes", "no"}:
        raise HTTPException(status_code=400, detail="Choose yes or no")
    return value.lower()


@router.get("/api/task-replies")
async def list_replies(passenger_id: int) -> dict:
    if passenger_id < 1 or passenger_id > 4:
        raise HTTPException(status_code=400, detail="Unknown passenger")
    rows = await database().fetch(
        """
        SELECT task_key, answer
        FROM task_replies
        WHERE passenger_id = $1
        ORDER BY task_key
        """,
        passenger_id,
    )
    return {"replies": [{"task_key": row["task_key"], "answer": row["answer"]} for row in rows]}


@router.post("/api/task-replies")
async def save_reply(body: ReplyIn) -> dict[str, str]:
    answer = clean_answer(body.reply, body.answer)
    if body.reply == "time":
        require_early_arrival(await departs_for(body.passenger_id), answer)
    await database().execute(
        """
        INSERT INTO task_replies (passenger_id, task_key, answer)
        VALUES ($1, $2, $3)
        ON CONFLICT (passenger_id, task_key)
        DO UPDATE SET answer = EXCLUDED.answer, updated_at = now()
        """,
        body.passenger_id,
        body.task_key.strip(),
        answer,
    )
    return {"task_key": body.task_key.strip(), "answer": answer}
