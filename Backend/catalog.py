"""Catalog tables loaded from Cathay DB.xlsx."""

TABLES = [
    (
        "airports",
        [
            ("airport_id", "INTEGER PRIMARY KEY"),
            ("iata", "TEXT NOT NULL"),
            ("name", "TEXT NOT NULL"),
        ],
        "airport_id",
    ),
    (
        "groups",
        [
            ("group_id", "INTEGER PRIMARY KEY"),
            ("name", "TEXT NOT NULL"),
            ("acronym", "TEXT NOT NULL"),
        ],
        "group_id",
    ),
    (
        "passengers",
        [
            ("passenger_id", "INTEGER PRIMARY KEY"),
            ("name", "TEXT NOT NULL"),
        ],
        "passenger_id",
    ),
    (
        "services",
        [
            ("service_id", "INTEGER PRIMARY KEY"),
            ("source_group", "TEXT NOT NULL"),
            ("service_name", "TEXT NOT NULL"),
            ("description", "TEXT NOT NULL"),
            ("source", "TEXT"),
        ],
        "service_id",
    ),
    (
        "tags",
        [
            ("tag_id", "INTEGER PRIMARY KEY"),
            ("group_id", "INTEGER NOT NULL REFERENCES groups (group_id)"),
            ("group_name", "TEXT NOT NULL"),
            ("name", "TEXT NOT NULL"),
            ("detail", "TEXT"),
        ],
        "tag_id",
    ),
    (
        "airport_services",
        [
            ("airport_service_id", "INTEGER PRIMARY KEY"),
            ("airport_id", "INTEGER NOT NULL REFERENCES airports (airport_id)"),
            ("service_name", "TEXT NOT NULL"),
            ("description", "TEXT NOT NULL"),
            ("source", "TEXT"),
        ],
        "airport_service_id",
    ),
    (
        "bookings",
        [
            ("booking_id", "INTEGER PRIMARY KEY"),
            ("passenger_id", "INTEGER NOT NULL REFERENCES passengers (passenger_id)"),
            ("departure_airport_id", "INTEGER NOT NULL REFERENCES airports (airport_id)"),
            ("transit_airport_id", "INTEGER REFERENCES airports (airport_id)"),
            ("arrival_airport_id", "INTEGER NOT NULL REFERENCES airports (airport_id)"),
            ("departs_at", "TEXT NOT NULL"),
            ("party_size", "INTEGER NOT NULL"),
            ("flight", "TEXT NOT NULL"),
        ],
        "booking_id",
    ),
    (
        "service_actions",
        [
            ("action_id", "INTEGER PRIMARY KEY"),
            ("service_id", "INTEGER NOT NULL REFERENCES services (service_id)"),
            ("step", "INTEGER NOT NULL"),
            ("when", "TEXT NOT NULL"),
            ("stage", "TEXT NOT NULL"),
            ("who_to_contact", "TEXT NOT NULL"),
            ("what_to_do", "TEXT NOT NULL"),
            ("source", "TEXT"),
            ("kind", "TEXT NOT NULL"),
            ("reply", "TEXT"),
        ],
        "action_id",
    ),
    (
        "airport_service_actions",
        [
            ("action_id", "INTEGER PRIMARY KEY"),
            ("airport_service_id", "INTEGER NOT NULL REFERENCES airport_services (airport_service_id)"),
            ("step", "INTEGER NOT NULL"),
            ("when", "TEXT NOT NULL"),
            ("stage", "TEXT NOT NULL"),
            ("who_to_contact", "TEXT NOT NULL"),
            ("what_to_do", "TEXT NOT NULL"),
            ("source", "TEXT"),
            ("kind", "TEXT NOT NULL"),
            ("reply", "TEXT"),
        ],
        "action_id",
    ),
    (
        "airport_service_legs",
        [
            ("airport_service_id", "INTEGER NOT NULL REFERENCES airport_services (airport_service_id)"),
            ("name", "TEXT NOT NULL"),
            ("leg", "TEXT NOT NULL"),
        ],
        "airport_service_id, leg",
    ),
    (
        "needs",
        [
            ("need_id", "INTEGER PRIMARY KEY"),
            ("group_id", "INTEGER NOT NULL REFERENCES groups (group_id)"),
            ("group_name", "TEXT NOT NULL"),
            ("service_name", "TEXT NOT NULL"),
            ("cathay_has_service", "TEXT NOT NULL"),
            ("airport_has_service", "TEXT NOT NULL"),
            ("airport_service_id", "INTEGER REFERENCES airport_services (airport_service_id)"),
        ],
        "need_id",
    ),
    (
        "need_services",
        [
            ("need_id", "INTEGER NOT NULL REFERENCES needs (need_id)"),
            ("service_id", "INTEGER NOT NULL REFERENCES services (service_id)"),
        ],
        "need_id, service_id",
    ),
    (
        "rules",
        [
            ("rule_id", "INTEGER PRIMARY KEY"),
            ("name", "TEXT NOT NULL"),
            ("notice", "TEXT NOT NULL"),
            ("who_to_contact", "TEXT NOT NULL"),
            ("applies_when", "TEXT NOT NULL"),
            ("requirement", "TEXT NOT NULL"),
            ("source", "TEXT"),
            ("kind", "TEXT NOT NULL"),
        ],
        "rule_id",
    ),
    (
        "rule_links",
        [
            ("rule_link_id", "INTEGER PRIMARY KEY"),
            ("rule_id", "INTEGER NOT NULL REFERENCES rules (rule_id)"),
            ("rule_name", "TEXT NOT NULL"),
            ("group_id", "INTEGER NOT NULL REFERENCES groups (group_id)"),
            ("group_name", "TEXT NOT NULL"),
            ("need_id", "INTEGER REFERENCES needs (need_id)"),
            ("service_name", "TEXT"),
            ("show_when", "TEXT NOT NULL"),
        ],
        "rule_link_id",
    ),
    (
        "tag_services",
        [
            ("tag_id", "INTEGER NOT NULL REFERENCES tags (tag_id)"),
            ("tag_name", "TEXT NOT NULL"),
            ("service_id", "INTEGER NOT NULL REFERENCES services (service_id)"),
            ("service_name", "TEXT NOT NULL"),
        ],
        "tag_id, service_id",
    ),
    (
        "profile_groups",
        [
            ("passenger_id", "INTEGER NOT NULL REFERENCES passengers (passenger_id)"),
            ("group_id", "INTEGER NOT NULL REFERENCES groups (group_id)"),
            ("tag_id", "INTEGER REFERENCES tags (tag_id)"),
        ],
        "passenger_id, group_id",
    ),
    (
        "survey_answers",
        [
            ("passenger_id", "INTEGER NOT NULL REFERENCES passengers (passenger_id)"),
            ("service_id", "INTEGER REFERENCES services (service_id)"),
            ("airport_service_id", "INTEGER REFERENCES airport_services (airport_service_id)"),
            ("need_id", "INTEGER REFERENCES needs (need_id)"),
            ("answer", "TEXT NOT NULL"),
        ],
        "passenger_id, service_id, airport_service_id, need_id",
    ),
    (
        "tasks",
        [
            ("task_id", "INTEGER PRIMARY KEY"),
            ("booking_id", "INTEGER NOT NULL REFERENCES bookings (booking_id)"),
            ("what_to_do", "TEXT NOT NULL"),
            ("due_at", "TEXT"),
            ("status", "TEXT NOT NULL"),
        ],
        "task_id",
    ),
]

PRIMARY_KEYS = {
    "airport_service_legs": "(airport_service_id, leg)",
    "need_services": "(need_id, service_id)",
    "tag_services": "(tag_id, service_id)",
    "profile_groups": "(passenger_id, group_id)",
}

DROP_TABLES = """
DROP TABLE IF EXISTS
    survey, survey_answers, profile_groups, rule_links, need_services, needs, rules,
    legs, airport_service_legs, airport_actions, airport_service_actions, service_actions,
    tasks, bookings, airport_services, tag_services, tags, services, passengers, groups, airports
CASCADE
"""


def _sql_name(column: str) -> str:
    if column == "when":
        return '"when"'
    return column


def schema_statements() -> list[str]:
    statements = []
    for name, columns, _order in TABLES:
        body = ",\n    ".join(f"{_sql_name(column)} {kind}" for column, kind in columns)
        extra = ""
        if name in PRIMARY_KEYS:
            extra = f",\n    PRIMARY KEY {PRIMARY_KEYS[name]}"
        statements.append(f"CREATE TABLE {name} (\n    {body}{extra}\n)")
    return statements


def _column_kind(table: str, column: str) -> str:
    for name, columns, _order in TABLES:
        if name != table:
            continue
        for col, kind in columns:
            if col == column:
                return kind
    raise KeyError(column)


def _value(table: str, column: str, row: dict):
    raw = row.get(column)
    if raw is None or raw == "":
        return None
    if _column_kind(table, column).startswith("INTEGER"):
        return int(float(raw))
    return str(raw)


async def ensure_catalog(conn) -> None:
    await conn.execute(DROP_TABLES)
    for statement in schema_statements():
        await conn.execute(statement)


async def fetch_catalog(conn) -> dict:
    catalog = {}
    for name, columns, order in TABLES:
        selected = [_sql_name(column) for column, _kind in columns]
        rows = await conn.fetch(f"SELECT {', '.join(selected)} FROM {name} ORDER BY {order}")
        catalog[name] = [{column: row[column] for column, _kind in columns} for row in rows]
    return catalog


def fetch_catalog_offline() -> dict:
    from pathlib import Path
    try:
        from import_catalog import read_catalog
        for candidate in [
            Path(__file__).resolve().parent / "Cathay DB.xlsx",
            Path(__file__).resolve().parents[1] / "Cathay DB.xlsx",
        ]:
            if candidate.exists():
                return read_catalog(candidate)
    except Exception as exc:
        print(f"[CATALOG] Offline read failed: {exc}")
    return {}
