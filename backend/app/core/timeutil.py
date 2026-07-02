"""Naive-UTC datetime helpers.

Datetimes are stored naive in UTC; the API always emits ISO strings with a
``Z`` suffix and accepts any timezone-aware input.
"""

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def to_naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        return dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def iso_utc(dt: datetime) -> str:
    return to_naive_utc(dt).replace(microsecond=0).isoformat() + "Z"


def parse_utc(value: str) -> datetime:
    return to_naive_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
