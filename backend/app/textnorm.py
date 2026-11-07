"""Normalise odd Unicode punctuation that some models emit.

All mappings are single code point -> single code point (or deletion), so they are safe to apply to
each streamed token independently: no multi-character sequence can be split across tokens.
"""
from typing import Any

_MAP = {
    # hyphens
    0x2010: "-", 0x2011: "-", 0x2012: "-", 0x2043: "-", 0xFE63: "-", 0xFF0D: "-",
    # spaces
    0x00A0: " ", 0x2002: " ", 0x2003: " ", 0x2007: " ", 0x2009: " ", 0x200A: " ", 0x202F: " ", 0x205F: " ",
    # invisible characters
    0x00AD: None, 0x200B: None, 0x2060: None, 0xFEFF: None,
    # full-width / lenticular brackets used for citations
    0x3010: "[", 0x3011: "]", 0xFF3B: "[", 0xFF3D: "]",
}
_TABLE = {k: v for k, v in _MAP.items()}


def normalize_text(text: str) -> str:
    return text.translate(_TABLE)


def normalize_deep(value: Any) -> Any:
    """Apply normalize_text to every string inside nested dicts/lists."""
    if isinstance(value, str):
        return normalize_text(value)
    if isinstance(value, list):
        return [normalize_deep(v) for v in value]
    if isinstance(value, dict):
        return {k: normalize_deep(v) for k, v in value.items()}
    return value
