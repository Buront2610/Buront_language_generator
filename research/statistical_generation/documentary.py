"""Local-only documentary pairs, distinct from human semantic annotations.

The manifest records published-human attribution evidence; it cannot authenticate
an author or prove semantic equivalence. Assistant/tool alignment is disclosed.
All teacher text is sliced from hashed, external UTF-8 document caches, never
accepted inline. Hashes establish capture integrity, not truth or permission.

Bridge v1: documents describe raw captures and extracted UTF-8 files; works name
one original across all adaptations; pairs contain source/target codepoint spans
(start inclusive, end exclusive). HTTP bodies and web-tool captures are separate
raw_kind values. Relative paths resolve beside the manifest. Captures, manifests,
and memorizing downstream models must remain outside the repository.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit

from .data import (DataError, MAX_FILE_BYTES, MAX_PAIRS, MAX_TEXT_CHARS, SPLITS,
                   _UnionFind, canonical_sha256, normalize_duplicate)

SCHEMA_VERSION = 1
MODE = "documentary_published_pairs"
SOURCE_KIND = "literary_adaptation"
QUALITY_STATUS = "documentary_research_unreviewed_no_quality_claim"
MAX_DOCUMENTS = 1000
MAX_TOTAL_DOCUMENT_BYTES = 128 * 1024 * 1024


def _object(value: Any, required: set[str], optional: set[str], error: str) -> dict:
    if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - optional:
        raise DataError(error)
    return value


def _string(value: Any, error: str, limit: int = 20000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise DataError(error)
    return value


def _identifier(value: Any) -> str:
    value = _string(value, "INVALID_DOCUMENTARY_ID", 200)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]*", value):
        raise DataError("INVALID_DOCUMENTARY_ID")
    return value


def _url(value: Any) -> str:
    value = _string(value, "DOCUMENTARY_URL_REQUIRED", 4000)
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise DataError("INVALID_DOCUMENTARY_URL")
    return value


def _hash(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise DataError("INVALID_DOCUMENTARY_SHA256")
    return value


def _strings(value: Any, error: str, nonempty: bool = True) -> list[str]:
    if not isinstance(value, list) or (nonempty and not value) or len(value) > MAX_DOCUMENTS:
        raise DataError(error)
    for item in value:
        _identifier(item)
    if len(value) != len(set(value)):
        raise DataError(error)
    return value


def _read(path: Path) -> bytes:
    if not path.is_file():
        raise DataError("DOCUMENTARY_FILE_MISSING: " + str(path))
    if path.stat().st_size > MAX_FILE_BYTES:
        raise DataError("DOCUMENTARY_FILE_TOO_LARGE")
    return path.read_bytes()


def _external(path: Path, repo: Path) -> Path:
    resolved = path.resolve()
    if resolved.is_relative_to(repo):
        raise DataError("DOCUMENTARY_PROTECTED_CACHE_MUST_REMAIN_OUTSIDE_REPOSITORY")
    return resolved


def _notes(value: dict) -> None:
    if "notes" in value:
        notes = value["notes"]
        if isinstance(notes, list):
            if not notes or len(notes) > 100:
                raise DataError("DOCUMENTARY_NOTES_REQUIRED")
            for item in notes:
                _string(item, "DOCUMENTARY_NOTES_REQUIRED")
        else:
            _string(notes, "DOCUMENTARY_NOTES_REQUIRED")


def _manifest(path: str | Path, repo: str | Path | None) -> tuple[dict, Path, Path]:
    repo_path = Path(repo).resolve() if repo is not None else Path(__file__).resolve().parents[2]
    manifest_path = _external(Path(path), repo_path)
    try:
        manifest = json.loads(_read(manifest_path).decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise DataError("INVALID_DOCUMENTARY_MANIFEST_JSON") from exc
    _object(manifest, {"schema_version", "mode", "scope", "source_kind", "documents", "works", "pairs"},
            {"notes", "created_at", "purpose"}, "INVALID_DOCUMENTARY_MANIFEST")
    if type(manifest["schema_version"]) is not int or manifest["schema_version"] != SCHEMA_VERSION:
        raise DataError("UNSUPPORTED_DOCUMENTARY_SCHEMA")
    if manifest["mode"] != MODE or manifest["scope"] != "local_research_only" or manifest["source_kind"] != SOURCE_KIND:
        raise DataError("DOCUMENTARY_LOCAL_RESEARCH_SCOPE_REQUIRED")
    _notes(manifest)
    for field in ("created_at", "purpose"):
        if field in manifest:
            _string(manifest[field], "INVALID_DOCUMENTARY_METADATA")
    return manifest, manifest_path, repo_path


def _documents(manifest: dict, manifest_path: Path, repo: Path) -> tuple[dict, dict, dict]:
    values = manifest["documents"]
    if not isinstance(values, list) or not 1 <= len(values) <= MAX_DOCUMENTS:
        raise DataError("DOCUMENTARY_DOCUMENTS_REQUIRED")
    docs, texts, hashes = {}, {}, {}
    total = 0
    for document in values:
        _object(document, {"document_id", "url", "title", "version", "retrieved_at", "raw_path", "raw_sha256",
                           "raw_kind", "text_path", "text_sha256", "extraction", "authorship_evidence", "rights"},
                {"notes"}, "INVALID_DOCUMENTARY_DOCUMENT")
        document_id = _identifier(document["document_id"])
        if document_id in docs:
            raise DataError("DUPLICATE_DOCUMENTARY_DOCUMENT_ID")
        _url(document["url"])
        for field in ("title", "version", "retrieved_at"):
            _string(document[field], "DOCUMENTARY_METADATA_REQUIRED: " + field)
        _notes(document)
        if document["raw_kind"] not in {"http_response_body", "web_tool_capture"}:
            raise DataError("DOCUMENTARY_RAW_CAPTURE_KIND_REQUIRED")
        extraction = _object(document["extraction"], {"method", "notes"}, {"source_body_lines"}, "DOCUMENTARY_EXTRACTION_REQUIRED")
        _string(extraction["method"], "DOCUMENTARY_EXTRACTION_REQUIRED")
        _notes(extraction)
        if "source_body_lines" in extraction:
            lines = extraction["source_body_lines"]
            if not isinstance(lines, list) or len(lines) != 2 or any(type(n) is not int for n in lines) or not 0 <= lines[0] <= lines[1]:
                raise DataError("INVALID_DOCUMENTARY_EXTRACTION_LINES")
        evidence = _object(document["authorship_evidence"], {"status", "author", "evidence_url", "notes"}, set(),
                           "DOCUMENTARY_AUTHORSHIP_EVIDENCE_REQUIRED")
        if evidence["status"] != "published_human_attributed":
            raise DataError("PUBLISHED_HUMAN_AUTHORSHIP_EVIDENCE_REQUIRED")
        author = _string(evidence["author"], "DOCUMENTARY_ATTRIBUTED_AUTHOR_REQUIRED")
        if normalize_duplicate(author) in {"llm", "assistant", "synthetic", "generated", "machine", "chatgpt", "openai"}:
            raise DataError("GENERATED_DOCUMENTARY_TEACHERS_FORBIDDEN")
        _url(evidence["evidence_url"])
        _notes(evidence)
        rights = _object(document["rights"], {"status", "notes", "redistribution_allowed"}, {"evidence_url"},
                         "DOCUMENTARY_RIGHTS_METADATA_REQUIRED")
        if rights["status"] not in {"unknown", "public_domain", "licensed"} or rights["redistribution_allowed"] is not False:
            raise DataError("DOCUMENTARY_LOCAL_ONLY_RIGHTS_REQUIRED")
        _notes(rights)
        if rights.get("evidence_url") is not None:
            _url(rights["evidence_url"])
        checked = copy.deepcopy(document)
        checked_hashes = {}
        for kind in ("raw", "text"):
            filename = _string(document[kind + "_path"], "DOCUMENTARY_CACHE_PATH_REQUIRED", 4000)
            path = _external(manifest_path.parent / filename, repo)
            raw = _read(path)
            total += len(raw)
            if total > MAX_TOTAL_DOCUMENT_BYTES:
                raise DataError("DOCUMENTARY_TOTAL_CACHE_TOO_LARGE")
            actual = hashlib.sha256(raw).hexdigest()
            if actual != _hash(document[kind + "_sha256"]):
                raise DataError("DOCUMENTARY_SOURCE_HASH_MISMATCH: " + document_id + ":" + kind)
            checked[kind + "_path"] = str(path)
            checked_hashes[kind + "_sha256"] = actual
            if kind == "text":
                try:
                    texts[document_id] = raw.decode("utf-8")
                except UnicodeError as exc:
                    raise DataError("DOCUMENTARY_TEXT_MUST_BE_UTF8") from exc
                if not texts[document_id].strip():
                    raise DataError("DOCUMENTARY_EMPTY_TEXT")
        docs[document_id], hashes[document_id] = checked, checked_hashes
    return docs, texts, dict(sorted(hashes.items()))


def _works(manifest: dict, docs: dict) -> dict:
    values = manifest["works"]
    if not isinstance(values, list) or not 1 <= len(values) <= MAX_DOCUMENTS:
        raise DataError("DOCUMENTARY_WORKS_REQUIRED")
    works = {}
    for work in values:
        _object(work, {"work_id", "title", "original_author", "source_document_ids", "adaptation_document_ids",
                       "relationship_evidence", "version_status"}, {"family_ids", "notes"}, "INVALID_DOCUMENTARY_WORK")
        work_id = _identifier(work["work_id"])
        if work_id in works:
            raise DataError("DUPLICATE_DOCUMENTARY_WORK_ID")
        for field in ("title", "original_author"):
            _string(work[field], "DOCUMENTARY_WORK_METADATA_REQUIRED")
        if work["version_status"] not in {"documented", "uncertain"}:
            raise DataError("DOCUMENTARY_VERSION_STATUS_REQUIRED")
        _notes(work)
        evidence = _object(work["relationship_evidence"], {"url", "notes"}, set(), "DOCUMENTARY_RELATIONSHIP_REQUIRED")
        _url(evidence["url"])
        _notes(evidence)
        for field in ("source_document_ids", "adaptation_document_ids"):
            ids = _strings(work[field], "DOCUMENTARY_WORK_DOCUMENTS_REQUIRED")
            if set(ids) - docs.keys():
                raise DataError("UNKNOWN_DOCUMENTARY_WORK_DOCUMENT")
        _strings(work.get("family_ids", []), "INVALID_DOCUMENTARY_WORK_FAMILIES", nonempty=False)
        works[work_id] = copy.deepcopy(work)
    return works


def _span(value: Any, texts: dict, docs: dict) -> tuple[str, dict]:
    span = _object(value, {"document_id", "start", "end"},
                   {"sha256_utf8", "web_lines_inclusive", "html_p_ids_inclusive"}, "INVALID_DOCUMENTARY_SPAN")
    document_id = _identifier(span["document_id"])
    if document_id not in texts:
        raise DataError("UNKNOWN_DOCUMENTARY_SPAN_DOCUMENT")
    start, end = span["start"], span["end"]
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(texts[document_id]):
        raise DataError("DOCUMENTARY_SPAN_OUT_OF_RANGE")
    text = texts[document_id][start:end]
    if not text.strip() or len(text) > MAX_TEXT_CHARS or "\x00" in text:
        raise DataError("INVALID_DOCUMENTARY_PAIR_TEXT")
    if "sha256_utf8" in span and _hash(span["sha256_utf8"]) != hashlib.sha256(text.encode("utf-8")).hexdigest():
        raise DataError("DOCUMENTARY_SPAN_HASH_MISMATCH")
    for field in ("web_lines_inclusive", "html_p_ids_inclusive"):
        if field in span:
            bounds = span[field]
            if not isinstance(bounds, list) or len(bounds) != 2 or any(type(n) is not int for n in bounds) or not 0 <= bounds[0] <= bounds[1]:
                raise DataError("INVALID_DOCUMENTARY_CAPTURE_LOCATOR")
    return text, {**copy.deepcopy(span), "offset_unit": "unicode_codepoint", "end_exclusive": True,
                  "url": docs[document_id]["url"], "text_sha256": docs[document_id]["text_sha256"],
                  "raw_sha256": docs[document_id]["raw_sha256"]}


def _components(rows: list[dict]) -> list[dict]:
    uf = _UnionFind()
    for row in rows:
        work = row["source"]["work"]
        nodes = ["pair:" + row["pair_id"], "work:" + work["work_id"],
                 "work_title_author:" + canonical_sha256([normalize_duplicate(work["title"]),
                                                            normalize_duplicate(work["original_author"])])]
        nodes.extend("work_family:" + item for item in work.get("family_ids", []))
        # A common namespace joins reversed/exact duplicates across both sides.
        nodes.extend("text:" + canonical_sha256(normalize_duplicate(row[field]))
                     for field in ("ordinary_text", "original_text"))
        uf.join(nodes)
    grouped = defaultdict(list)
    for row in rows:
        grouped[uf.find("pair:" + row["pair_id"])].append(row)
    components = []
    for members in grouped.values():
        ids = sorted(row["pair_id"] for row in members)
        components.append({"component_id": "documentary_component_" + canonical_sha256(ids)[:24],
                           "pair_ids": ids, "work_ids": sorted({row["source"]["work"]["work_id"] for row in members})})
    return sorted(components, key=lambda value: value["component_id"])


def load_documentary_pairs(manifest_path: str | Path, repo: str | Path | None = None) -> list[dict]:
    """Validate every document capture and derive exact pairs; no human review."""
    manifest, path, repo_path = _manifest(manifest_path, repo)
    docs, texts, hashes = _documents(manifest, path, repo_path)
    works = _works(manifest, docs)
    records = manifest["pairs"]
    if not isinstance(records, list) or not 1 <= len(records) <= MAX_PAIRS:
        raise DataError("DOCUMENTARY_PAIRS_REQUIRED")
    manifest_hash = canonical_sha256(manifest)
    rows, seen = [], set()
    for pair in records:
        _object(pair, {"work_id", "source", "target", "alignment", "semantic_review_status", "human_review"},
                {"pair_id", "notes", "known_semantic_deviation"}, "INVALID_DOCUMENTARY_PAIR")
        work_id = _identifier(pair["work_id"])
        if work_id not in works:
            raise DataError("UNKNOWN_DOCUMENTARY_WORK")
        if pair["semantic_review_status"] != "unreviewed" or pair["human_review"] is not None:
            raise DataError("DOCUMENTARY_MUST_REMAIN_SEMANTICALLY_UNREVIEWED")
        alignment = _object(pair["alignment"], {"method", "notes"}, {"event_label"}, "DOCUMENTARY_ALIGNMENT_DISCLOSURE_REQUIRED")
        if alignment["method"] not in {"assistant", "tool", "assistant_and_tool"}:
            raise DataError("DOCUMENTARY_ALIGNMENT_DISCLOSURE_REQUIRED")
        _notes(alignment)
        if "event_label" in alignment:
            _string(alignment["event_label"], "INVALID_DOCUMENTARY_EVENT_LABEL")
        _notes(pair)
        if pair.get("known_semantic_deviation") is not None:
            _string(pair["known_semantic_deviation"], "INVALID_DOCUMENTARY_DEVIATION_NOTE")
        ordinary, source = _span(pair["source"], texts, docs)
        adaptation, target = _span(pair["target"], texts, docs)
        work = works[work_id]
        if source["document_id"] not in work["source_document_ids"] or target["document_id"] not in work["adaptation_document_ids"]:
            raise DataError("DOCUMENTARY_PAIR_WORK_DOCUMENT_MISMATCH")
        identity = {"work_id": work_id,
                    "source": {**{key: pair["source"][key] for key in ("document_id", "start", "end")}, "text_sha256": source["text_sha256"]},
                    "target": {**{key: pair["target"][key] for key in ("document_id", "start", "end")}, "text_sha256": target["text_sha256"]}}
        pair_id = "documentary_" + canonical_sha256(identity)[:32]
        if pair_id in seen:
            raise DataError("DUPLICATE_DOCUMENTARY_PAIR")
        if "pair_id" in pair and pair["pair_id"] != pair_id:
            raise DataError("DOCUMENTARY_PAIR_ID_MISMATCH")
        seen.add(pair_id)
        rows.append({"schema_version": SCHEMA_VERSION, "mode": MODE, "source_kind": SOURCE_KIND,
                     "pair_id": pair_id, "ordinary_text": ordinary, "original_text": adaptation,
                     "semantic_review_status": "unreviewed", "human_review": None,
                     "alignment": copy.deepcopy(alignment),
                     "source": {"manifest_sha256": manifest_hash, "document_hashes": hashes,
                                "work": copy.deepcopy(work), "original": source, "adaptation": target,
                                "original_document": copy.deepcopy(docs[source["document_id"]]),
                                "adaptation_document": copy.deepcopy(docs[target["document_id"]]),
                                "scope": "local_research_only", "attribution": "published_human_attributed_not_authenticated",
                                "pair_metadata": {key: copy.deepcopy(pair[key]) for key in ("notes", "known_semantic_deviation") if key in pair}},
                     "lineage": {"work_id": work_id, "component_id": "",
                                 "duplicate_family_ids": sorted({"documentary_exact_" + canonical_sha256(normalize_duplicate(t))[:24]
                                                                  for t in (ordinary, adaptation)})}})
    component_by_pair = {pair_id: group["component_id"] for group in _components(rows) for pair_id in group["pair_ids"]}
    record_ids_hash = canonical_sha256(sorted(row["pair_id"] for row in rows))
    for row in rows:
        row["lineage"]["component_id"] = component_by_pair[row["pair_id"]]
        row["source"]["record_ids_sha256"] = record_ids_hash
    return sorted(rows, key=lambda value: value["pair_id"])


def _rows(rows: Iterable[dict]) -> list[dict]:
    values = []
    for row in rows:
        if len(values) >= MAX_PAIRS:
            raise DataError("TOO_MANY_DOCUMENTARY_PAIRS")
        _object(row, {"schema_version", "mode", "source_kind", "pair_id", "ordinary_text", "original_text",
                      "semantic_review_status", "human_review", "alignment", "source", "lineage"}, set(),
                "INVALID_DERIVED_DOCUMENTARY_ROW")
        if type(row["schema_version"]) is not int or row["schema_version"] != SCHEMA_VERSION or row["mode"] != MODE or row["source_kind"] != SOURCE_KIND:
            raise DataError("INVALID_DERIVED_DOCUMENTARY_MODE")
        if row["semantic_review_status"] != "unreviewed" or row["human_review"] is not None:
            raise DataError("DOCUMENTARY_MUST_REMAIN_SEMANTICALLY_UNREVIEWED")
        _identifier(row["pair_id"])
        for field in ("ordinary_text", "original_text"):
            _string(row[field], "INVALID_DOCUMENTARY_PAIR_TEXT", MAX_TEXT_CHARS)
        if not isinstance(row["source"], dict) or not isinstance(row["lineage"], dict):
            raise DataError("DOCUMENTARY_PROVENANCE_REQUIRED")
        for field in ("manifest_sha256", "record_ids_sha256"):
            _hash(row["source"].get(field))
        if not isinstance(row["source"].get("document_hashes"), dict) or not isinstance(row["source"].get("work"), dict):
            raise DataError("DOCUMENTARY_PROVENANCE_REQUIRED")
        values.append(copy.deepcopy(row))
    if not values:
        raise DataError("DOCUMENTARY_PAIRS_REQUIRED")
    ids = [row["pair_id"] for row in values]
    if len(set(ids)) != len(ids):
        raise DataError("DUPLICATE_DOCUMENTARY_PAIR")
    if any(row["source"]["record_ids_sha256"] != canonical_sha256(sorted(ids)) for row in values):
        raise DataError("DOCUMENTARY_FULL_RECORD_SET_REQUIRED")
    bindings = {(row["source"]["manifest_sha256"], canonical_sha256(row["source"]["document_hashes"])) for row in values}
    if len(bindings) != 1:
        raise DataError("DOCUMENTARY_MANIFEST_BINDING_MISMATCH")
    return sorted(values, key=lambda value: value["pair_id"])


def validate_documentary_pairs(rows: Iterable[dict], manifest_path: str | Path,
                               repo: str | Path | None = None) -> list[dict]:
    values = _rows(rows)
    expected = load_documentary_pairs(manifest_path, repo)
    if values != expected:
        raise DataError("DOCUMENTARY_DERIVED_RECORD_MISMATCH")
    return expected


def _split(rows: list[dict], seed: str | int, train_ratio: float) -> dict:
    if isinstance(seed, bool) or not isinstance(seed, (str, int)):
        raise DataError("INVALID_SPLIT_SEED")
    if isinstance(train_ratio, bool) or not isinstance(train_ratio, (int, float)) or not math.isfinite(train_ratio) or not 0 < train_ratio < 1:
        raise DataError("INVALID_TRAIN_RATIO")
    components = _components(rows)
    if len(components) < 3:
        raise DataError("INSUFFICIENT_INDEPENDENT_DOCUMENTARY_WORK_COMPONENTS: at least 3 required for wiring")
    # Compare row lineage to the closure instead of trusting caller labels.
    component_by_pair = {pid: c["component_id"] for c in components for pid in c["pair_ids"]}
    if any(row["lineage"].get("component_id") != component_by_pair[row["pair_id"]] for row in rows):
        raise DataError("DOCUMENTARY_LINEAGE_MISMATCH")
    ranked = sorted(components, key=lambda group: canonical_sha256([str(seed), group["component_id"]]))
    n_train = min(len(ranked) - 2, max(1, int(len(ranked) * train_ratio)))
    n_dev = max(1, (len(ranked) - n_train) // 2)
    assignments = {}
    for index, group in enumerate(ranked):
        group["split"] = "train" if index < n_train else "dev" if index < n_train + n_dev else "test"
        assignments.update({pid: group["split"] for pid in group["pair_ids"]})
    return {"schema_version": SCHEMA_VERSION, "mode": MODE, "source_kind": SOURCE_KIND,
            "input_sha256": canonical_sha256(rows), "source_manifest_sha256": rows[0]["source"]["manifest_sha256"],
            "document_hashes": copy.deepcopy(rows[0]["source"]["document_hashes"]),
            "seed": str(seed), "train_ratio": train_ratio,
            "components": sorted(ranked, key=lambda group: group["component_id"]),
            "assignments": dict(sorted(assignments.items())),
            "counts": {name: sum(split == name for split in assignments.values()) for name in SPLITS},
            "component_counts": {name: sum(group["split"] == name for group in ranked) for name in SPLITS},
            "work_counts": {name: len({wid for group in ranked if group["split"] == name for wid in group["work_ids"]}) for name in SPLITS},
            "quality_status": QUALITY_STATUS, "semantic_review_status": "unreviewed", "human_review": None,
            "leakage_scope": "whole original works, declared families, title-author aliases, normalized exact cross-side duplicates; unknown versions and semantic duplicates remain unreviewed"}


def make_documentary_split(rows: Iterable[dict], seed: str | int, train_ratio: float = 0.8) -> dict:
    """Freeze whole-work train/dev/test; three groups enable wiring only."""
    return _split(_rows(rows), seed, train_ratio)


def validate_documentary_split(rows: Iterable[dict], split_manifest: dict,
                               manifest_path: str | Path | None = None,
                               repo: str | Path | None = None) -> dict[str, list[dict]]:
    """Recompute deterministic assignments and optionally reread all source bytes.

    Training/replay callers MUST provide manifest_path (or separately call
    validate_documentary_pairs immediately beforehand). Omitting it only checks
    the frozen record/split contract, not current cache availability/integrity.
    """
    values = validate_documentary_pairs(rows, manifest_path, repo) if manifest_path is not None else _rows(rows)
    if not isinstance(split_manifest, dict):
        raise DataError("INVALID_DOCUMENTARY_SPLIT_MANIFEST")
    if split_manifest.get("input_sha256") != canonical_sha256(values):
        raise DataError("FROZEN_DOCUMENTARY_INPUT_HASH_MISMATCH")
    expected = _split(values, split_manifest.get("seed"), split_manifest.get("train_ratio"))
    if split_manifest != expected:
        raise DataError("DOCUMENTARY_SPLIT_MANIFEST_MISMATCH")
    return {name: [row for row in values if expected["assignments"][row["pair_id"]] == name] for name in SPLITS}
