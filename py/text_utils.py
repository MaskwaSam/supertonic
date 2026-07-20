"""Pure, model-free text chunking and CLI validation helpers."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Sequence

AVAILABLE_LANGS = (
    "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es",
    "et", "fi", "fr", "hi", "hr", "hu", "id", "it", "lt", "lv",
    "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi",
)

MIN_TOTAL_STEP = 1
MAX_TOTAL_STEP = 100
MIN_SPEED = 0.25
MAX_SPEED = 4.0
MIN_N_TEST = 1
MAX_N_TEST = 100
MAX_TEXT_CODEPOINTS = 100_000

_ABBREVIATIONS = {
    "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "Jr.", "St.",
    "Ave.", "Rd.", "Blvd.", "Dept.", "Inc.", "Ltd.", "Co.",
    "Corp.", "etc.", "vs.", "i.e.", "e.g.", "Ph.D.",
}


def _is_abbreviation(prefix: str) -> bool:
    token = prefix.rstrip().split()[-1] if prefix.rstrip() else ""
    return token in _ABBREVIATIONS or bool(re.fullmatch(r"[A-Z]\.", token))


def _split_sentences(text: str) -> list[str]:
    sentences: list[str] = []
    start = 0
    for match in re.finditer(r"[.!?](?=\s|$)", text):
        end = match.end()
        if text[match.start()] == "." and _is_abbreviation(text[start:end]):
            continue
        sentence = text[start:end].strip()
        if sentence:
            sentences.append(sentence)
        whitespace = re.match(r"\s*", text[end:])
        start = end + (whitespace.end() if whitespace else 0)
    tail = text[start:].strip()
    if tail:
        sentences.append(tail)
    return sentences


def _hard_wrap(text: str, max_len: int) -> list[str]:
    chunks: list[str] = []
    current = ""
    for word in text.split():
        while len(word) > max_len:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(word[:max_len])
            word = word[max_len:]
        if not word:
            continue
        candidate = f"{current} {word}" if current else word
        if len(candidate) <= max_len:
            current = candidate
        else:
            chunks.append(current)
            current = word
    if current:
        chunks.append(current)
    return chunks


def chunk_text(text: str, max_len: int = 300) -> list[str]:
    """Chunk text without exceeding ``max_len`` Unicode scalar values."""
    if not isinstance(text, str):
        raise TypeError(f"chunk_text expects str, got {type(text).__name__}")
    if max_len <= 0:
        raise ValueError("max_len must be positive")

    text = text.strip()
    if not text:
        return []

    chunks: list[str] = []
    for paragraph in re.split(r"\n\s*\n+", text):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        current = ""
        for sentence in _split_sentences(paragraph):
            if len(sentence) > max_len:
                if current:
                    chunks.append(current)
                    current = ""
                chunks.extend(_hard_wrap(sentence, max_len))
                continue
            candidate = f"{current} {sentence}" if current else sentence
            if len(candidate) <= max_len:
                current = candidate
            else:
                chunks.append(current)
                current = sentence
        if current:
            chunks.append(current)
    return chunks


@dataclass(frozen=True)
class CliInputs:
    total_step: int
    speed: float
    n_test: int
    text: Sequence[str]
    lang: Sequence[str]


def validate_cli_inputs(values: CliInputs) -> None:
    """Reject unsafe CLI values before model loading."""
    if not MIN_TOTAL_STEP <= values.total_step <= MAX_TOTAL_STEP:
        raise ValueError(f"--total-step must be between {MIN_TOTAL_STEP} and {MAX_TOTAL_STEP}")
    if not math.isfinite(values.speed) or not MIN_SPEED <= values.speed <= MAX_SPEED:
        raise ValueError(f"--speed must be finite and between {MIN_SPEED} and {MAX_SPEED}")
    if not MIN_N_TEST <= values.n_test <= MAX_N_TEST:
        raise ValueError(f"--n-test must be between {MIN_N_TEST} and {MAX_N_TEST}")
    if not values.text:
        raise ValueError("at least one --text value is required")
    for text in values.text:
        if not text.strip():
            raise ValueError("--text values must not be blank")
        if len(text) > MAX_TEXT_CODEPOINTS:
            raise ValueError(f"--text values must not exceed {MAX_TEXT_CODEPOINTS} Unicode scalar values")
    if not values.lang:
        raise ValueError("at least one --lang value is required")
    invalid = [lang for lang in values.lang if lang not in AVAILABLE_LANGS]
    if invalid:
        raise ValueError(f"unsupported language code(s): {', '.join(invalid)}")
