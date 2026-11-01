"""Serialización canónica y manifiestos reproducibles."""

from __future__ import annotations

import hashlib
import json
import unicodedata
from pathlib import Path
from typing import Any, Mapping


def _normalize(value: Any) -> Any:
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, Mapping):
        return {unicodedata.normalize("NFC", str(key)): _normalize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize(item) for item in value]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    raise TypeError(f"Tipo no serializable en JSON canónico: {type(value).__name__}")


def canonical_json_bytes(value: Any) -> bytes:
    normalized = _normalize(value)
    return json.dumps(
        normalized,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def reproducible_manifest_payload(manifest: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in manifest.items() if key not in {"generatedAt", "manifestSha256"}}


def manifest_sha256(manifest: Mapping[str, Any]) -> str:
    return sha256_bytes(canonical_json_bytes(reproducible_manifest_payload(manifest)))


def write_json(path: Path, value: Any) -> None:
    path.write_bytes(canonical_json_bytes(value) + b"\n")
