"""Stores and summarizes passenger preferences for additional accessibility services."""

from collections import Counter

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

ALLOWED_CATEGORIES = (
    "Mobility",
    "Visual",
    "Hearing",
    "Cognitive",
    "Neurodivergence",
    "Sensory",
    "Communication",
    "Medical",
    "Other",
)

ALLOWED_SOURCES = ("chat", "questionnaire", "plan", "task-form")

SCHEMA = """
CREATE TABLE IF NOT EXISTS service_feedback (
    feedback_id BIGSERIAL PRIMARY KEY,
    passenger_id INTEGER NOT NULL CHECK (passenger_id BETWEEN 1 AND 4),
    category TEXT NOT NULL DEFAULT 'Other',
    preferred_service TEXT NOT NULL CHECK (char_length(preferred_service) BETWEEN 1 AND 200),
    details TEXT NOT NULL DEFAULT '' CHECK (char_length(details) <= 500),
    source_page TEXT NOT NULL DEFAULT 'chat',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

router = APIRouter()


class FeedbackIn(BaseModel):
    passenger_id: int = Field(ge=1, le=4)
    category: str = Field(default="Other", max_length=40)
    preferred_service: str = Field(min_length=1, max_length=200)
    details: str = Field(default="", max_length=500)
    source_page: str = Field(default="chat", max_length=40)


def database():
    import main

    if main.pool is None:
        raise HTTPException(status_code=503, detail="Database is not ready")
    return main.pool


def clean_feedback(body: FeedbackIn) -> dict:
    preferred_service = " ".join(body.preferred_service.split())
    if not preferred_service:
        raise HTTPException(status_code=400, detail="Enter an accessibility service preference")
    category = body.category.strip() or "Other"
    if category not in ALLOWED_CATEGORIES:
        category = "Other"
    source_page = body.source_page.strip().lower() or "chat"
    if source_page not in ALLOWED_SOURCES:
        source_page = "chat"
    details = body.details.strip()
    return {
        "passenger_id": body.passenger_id,
        "category": category,
        "preferred_service": preferred_service,
        "details": details,
        "source_page": source_page,
    }


def summarize_rows(rows: list[dict]) -> dict:
    category_counts = Counter()
    service_counts = Counter()
    source_counts = Counter()
    passengers = set()
    for row in rows:
        category_counts[row["category"]] += 1
        service_counts[row["preferred_service"]] += 1
        source_counts[row["source_page"]] += 1
        passengers.add(row["passenger_id"])
    return {
        "total": len(rows),
        "unique_services": len(service_counts),
        "unique_passengers": len(passengers),
        "by_category": [
            {"label": label, "count": count}
            for label, count in category_counts.most_common()
        ],
        "by_service": [
            {"label": label, "count": count}
            for label, count in service_counts.most_common()
        ],
        "by_source": [
            {"label": label, "count": count}
            for label, count in source_counts.most_common()
        ],
    }


@router.post("/api/feedback")
async def save_feedback(body: FeedbackIn) -> dict:
    cleaned = clean_feedback(body)
    row = await database().fetchrow(
        """
        INSERT INTO service_feedback (passenger_id, category, preferred_service, details, source_page)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING feedback_id, created_at
        """,
        cleaned["passenger_id"],
        cleaned["category"],
        cleaned["preferred_service"],
        cleaned["details"],
        cleaned["source_page"],
    )
    return {
        "status": "saved",
        "feedback_id": int(row["feedback_id"]),
        "created_at": row["created_at"].isoformat(),
    }


@router.get("/api/feedback")
async def list_feedback(category: str | None = None, passenger_id: int | None = None) -> dict:
    clauses = []
    params = []
    if category and category.strip() and category.strip().lower() != "all":
        params.append(category.strip())
        clauses.append(f"category = ${len(params)}")
    if passenger_id is not None:
        if passenger_id < 1 or passenger_id > 4:
            raise HTTPException(status_code=400, detail="Unknown passenger")
        params.append(passenger_id)
        clauses.append(f"passenger_id = ${len(params)}")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    records = await database().fetch(
        f"""
        SELECT f.feedback_id, f.passenger_id, p.name AS passenger_name,
               f.category, f.preferred_service, f.details, f.source_page, f.created_at
        FROM service_feedback f
        LEFT JOIN passengers p ON p.passenger_id = f.passenger_id
        {where}
        ORDER BY f.created_at DESC, f.feedback_id DESC
        """,
        *params,
    )
    items = [
        {
            "feedback_id": int(row["feedback_id"]),
            "passenger_id": int(row["passenger_id"]),
            "passenger_name": row["passenger_name"] or f"Passenger {row['passenger_id']}",
            "category": row["category"],
            "preferred_service": row["preferred_service"],
            "details": row["details"],
            "source_page": row["source_page"],
            "created_at": row["created_at"].isoformat(),
        }
        for row in records
    ]
    return {"items": items, "summary": summarize_rows(items)}
