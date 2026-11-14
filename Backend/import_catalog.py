"""Load Cathay DB.xlsx into the catalog tables."""

import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from catalog import TABLES, _sql_name, _value

CATALOG_XLSX = str(Path(__file__).resolve().parent / "Cathay DB.xlsx")
_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_EXCEL_EPOCH = datetime(1899, 12, 30)


def _column_index(cell_ref: str) -> int:
    letters = "".join(char for char in cell_ref if char.isalpha())
    index = 0
    for char in letters:
        index = index * 26 + ord(char.upper()) - 64
    return index - 1


def _shared_strings(book: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in book.namelist():
        return []
    root = ET.fromstring(book.read("xl/sharedStrings.xml"))
    return [
        "".join(node.text or "" for node in item.iter(f"{{{_NS}}}t"))
        for item in root.findall(f"{{{_NS}}}si")
    ]


def _cell_value(cell: ET.Element, shared: list[str]) -> str:
    kind = cell.attrib.get("t")
    if kind == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{{{_NS}}}t"))
    value = cell.find(f"{{{_NS}}}v")
    if value is None or value.text is None:
        return ""
    if kind == "s":
        return shared[int(value.text)]
    return value.text


def _part(target: str) -> str:
    target = target.lstrip("/")
    if target.startswith("../"):
        target = target[3:]
    if not target.startswith("xl/"):
        target = "xl/" + target
    return target


def _clock(value: str) -> str:
    try:
        serial = float(value)
    except ValueError:
        return value
    if serial < 20000:
        return value
    when = _EXCEL_EPOCH + timedelta(days=serial)
    return when.strftime("%Y-%m-%d %H:%M")


def _sheet_rows(book: zipfile.ZipFile, target: str, shared: list[str]) -> list[list[str]]:
    root = ET.fromstring(book.read(_part(target)))
    rows = []
    for row in root.findall(f"{{{_NS}}}sheetData/{{{_NS}}}row"):
        values: list[str] = []
        for cell in row.findall(f"{{{_NS}}}c"):
            index = _column_index(cell.attrib.get("r", "A1"))
            while len(values) <= index:
                values.append("")
            values[index] = _cell_value(cell, shared).strip()
        rows.append(values)
    return rows


def _sheet_targets(book: zipfile.ZipFile) -> dict[str, str]:
    package = "http://schemas.openxmlformats.org/package/2006/relationships"
    office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    workbook = ET.fromstring(book.read("xl/workbook.xml"))
    relations = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    targets = {
        item.attrib["Id"]: item.attrib["Target"]
        for item in relations.findall(f"{{{package}}}Relationship")
    }
    found = {}
    for sheet in workbook.findall(f"{{{_NS}}}sheets/{{{_NS}}}sheet"):
        name = sheet.attrib["name"]
        if name.startswith("_"):
            continue
        found[name] = targets[sheet.attrib[f"{{{office}}}id"]]
    return found


def read_catalog(path: Path = CATALOG_XLSX) -> dict[str, list[dict]]:
    """Read one sheet per catalog table. The first row is the column names."""
    with zipfile.ZipFile(path) as book:
        shared = _shared_strings(book)
        targets = _sheet_targets(book)
        sheets = {}
        for name, columns, _order in TABLES:
            if name not in targets:
                raise RuntimeError(f"{path.name} is missing the {name} sheet")
            rows = _sheet_rows(book, targets[name], shared)
            if not rows:
                raise RuntimeError(f"The {name} sheet is empty")
            header = rows[0]
            expected = [column for column, _kind in columns]
            if name == "bookings" and "flight" not in header and expected == header + ["flight"]:
                flight_map = {"1": "CX810", "2": "CX251", "3": "CX500", "4": "CX255"}
                records = []
                for values in rows[1:]:
                    padded = values + [""] * (len(header) - len(values))
                    if not any(padded[: len(header)]):
                        continue
                    record = dict(zip(header, padded[: len(header)]))
                    b_id = str(record.get("booking_id", "")).split(".")[0]
                    record["flight"] = flight_map.get(b_id, "CX810")
                    if record.get("departs_at"):
                        record["departs_at"] = _clock(record["departs_at"])
                    records.append(record)
                sheets[name] = records
                continue
            if header[: len(expected)] != expected:
                raise RuntimeError(f"The {name} sheet columns are {header}, expected {expected}")
            records = []
            for values in rows[1:]:
                padded = values + [""] * (len(expected) - len(values))
                if not any(padded[: len(expected)]):
                    continue
                record = dict(zip(expected, padded[: len(expected)]))
                for column in ("departs_at", "due_at"):
                    if column in record and record[column]:
                        record[column] = _clock(record[column])
                records.append(record)
            sheets[name] = records
    return sheets


async def import_catalog(conn, path: Path = CATALOG_XLSX) -> None:
    """Replace the catalog tables with the rows in the workbook."""
    sheets = read_catalog(path)
    names = ", ".join(name for name, _columns, _order in TABLES)
    async with conn.transaction():
        await conn.execute(f"TRUNCATE {names} RESTART IDENTITY CASCADE")
        for name, columns, _order in TABLES:
            cols = [_sql_name(column) for column, _kind in columns]
            placeholders = ", ".join(f"${index}" for index in range(1, len(cols) + 1))
            sql = f"INSERT INTO {name} ({', '.join(cols)}) VALUES ({placeholders})"
            payload = [
                tuple(_value(name, column, row) for column, _kind in columns)
                for row in sheets[name]
            ]
            if payload:
                await conn.executemany(sql, payload)