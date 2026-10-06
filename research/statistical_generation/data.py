"""Auditable, local-only human parallel-data intake. No automatic teachers.

All text normalization below is for conservative duplicate grouping, never for
rewriting a teacher sentence. Authorship attestations are declarations to review,
not proof of who typed a file. They cannot detect a person falsely claiming that
LLM output is human-authored. Existing archive attribution is unverified.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable
import unicodedata

SCHEMA_VERSION = 1
MAX_PAIRS = 10000
MAX_FILE_BYTES = 32 * 1024 * 1024
MAX_TEXT_CHARS = 5000
SPLITS = ("train", "dev", "test")
SOURCE_FILES = (
    "data/log-corpus.json",
    "data/quote-corpus.json",
    "artifacts/fulltext-analysis-20260921/posts.jsonl",
    "artifacts/fulltext-analysis-20260921/near-duplicates.json",
)


class DataError(ValueError):
    """A data integrity or human-review requirement was not satisfied."""


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def normalize_duplicate(text: str) -> str:
    return "".join(unicodedata.normalize("NFKC", text).casefold().split())


def _read_bytes(path: Path) -> bytes:
    if path.stat().st_size > MAX_FILE_BYTES:
        raise DataError(f"FILE_TOO_LARGE: {path.name}")
    return path.read_bytes()


def load_annotations(path: str | Path) -> list[dict]:
    """Load bounded JSONL. Blank exports remain invalid teachers."""
    text = _read_bytes(Path(path)).decode("utf-8")
    rows = []
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise DataError(f"INVALID_JSONL: line {number}") from exc
        if not isinstance(row, dict):
            raise DataError(f"INVALID_ROW: line {number}")
        rows.append(row)
        if len(rows) > MAX_PAIRS:
            raise DataError("TOO_MANY_PAIRS")
    return rows


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, node: str) -> str:
        self.parent.setdefault(node, node)
        root = node
        while self.parent[root] != root:
            root = self.parent[root]
        while node != root:
            parent = self.parent[node]
            self.parent[node] = root
            node = parent
        return root

    def join(self, nodes: Iterable[str]) -> None:
        nodes = sorted(set(nodes))
        if not nodes:
            return
        root = self.find(nodes[0])
        for node in nodes[1:]:
            other = self.find(node)
            if root != other:
                low, high = sorted((root, other))
                self.parent[high] = low
                root = low


class SourceCatalog:
    """Reconstruct immutable source identities and full-corpus leakage closure."""
    def __init__(self, repo: str | Path):
        self.repo = Path(repo)
        blobs = {name: _read_bytes(self.repo / name) for name in SOURCE_FILES}
        self.hashes = {name: hashlib.sha256(raw).hexdigest() for name, raw in blobs.items()}
        self.log = json.loads(blobs[SOURCE_FILES[0]])
        self.quotes = json.loads(blobs[SOURCE_FILES[1]])
        self.raw_posts = [json.loads(line) for line in blobs[SOURCE_FILES[2]].decode("utf-8").splitlines() if line]
        self.near_duplicates = json.loads(blobs[SOURCE_FILES[3]])
        self.posts = {post["id"]: post for post in self.log["posts"]}
        self.sentences = {row["id"]: row for row in self.log["sentences"]}
        if len(self.posts) != len(self.log["posts"]) or len(self.sentences) != len(self.log["sentences"]):
            raise DataError("DUPLICATE_SOURCE_ID")
        self.post_quotes: dict[str, set[str]] = defaultdict(set)
        self.post_variants: dict[str, set[str]] = defaultdict(set)
        self.post_leakages: dict[str, set[str]] = defaultdict(set)
        self.post_duplicates: dict[str, set[str]] = defaultdict(set)
        uf = _UnionFind()
        normalized_posts: dict[str, list[str]] = defaultdict(list)
        for post in self.posts.values():
            pid = post["id"]
            uf.find("post:" + pid)
            normalized = normalize_duplicate(post["content"])
            normalized_posts[normalized].append(pid)
            family = "post_exact_" + canonical_sha256(normalized)[:24]
            self.post_duplicates[pid].add(family)
            uf.join(["post:" + pid, "duplicate:" + family])
            if post.get("postUrl"):
                uf.join(["post:" + pid, "post_url:" + post["postUrl"]])
        for row in self.sentences.values():
            pid = row["postId"]
            if pid not in self.posts or row["text"] not in self.posts[pid]["content"]:
                raise DataError("SOURCE_SENTENCE_NOT_IN_POST")
            family = "sentence_exact_" + canonical_sha256(normalize_duplicate(row["text"]))[:24]
            self.post_duplicates[pid].add(family)
            uf.join(["post:" + pid, "duplicate:" + family])
        for quote in self.quotes["headings"] + self.quotes["excerpts"]:
            linked = set(quote.get("sourcePostIds", [])) | set(quote.get("leakagePostIds", []))
            linked |= {context["postId"] for context in quote.get("contexts", [])}
            unknown = linked - self.posts.keys()
            if unknown:
                raise DataError("UNKNOWN_QUOTE_POST: " + ",".join(sorted(unknown)))
            nodes = ["post:" + pid for pid in linked] + ["quote:" + quote["id"]]
            for field, prefix, destination in (
                ("variantGroupId", "variant:", self.post_variants),
                ("leakageGroupId", "leakage:", self.post_leakages),
            ):
                if quote.get(field):
                    nodes.append(prefix + quote[field])
                    for pid in linked:
                        destination[pid].add(quote[field])
            for pid in linked:
                self.post_quotes[pid].add(quote["id"])
            uf.join(nodes)
        for post in self.quotes["sourcePosts"]:
            if post["id"] not in self.posts:
                raise DataError("UNKNOWN_QUOTE_SOURCE_POST")
            group = post.get("leakageGroupId")
            if group:
                self.post_leakages[post["id"]].add(group)
                uf.join(["post:" + post["id"], "leakage:" + group])
        raw_by_id = {post["id"]: post for post in self.raw_posts}
        self.mapped_near_duplicate_pairs = 0
        for pair in self.near_duplicates:
            linked = set()
            for side in ("left", "right"):
                raw = raw_by_id.get(pair[side])
                if not raw:
                    raise DataError("UNKNOWN_NEAR_DUPLICATE_RAW_POST")
                matches = normalized_posts.get(normalize_duplicate(raw["text"]), [])
                if not matches:
                    raise DataError("UNMAPPED_NEAR_DUPLICATE_POST: " + pair[side])
                linked.update(matches)
            family = "near_" + canonical_sha256(sorted([pair["left"], pair["right"]]))[:24]
            for pid in linked:
                self.post_duplicates[pid].add(family)
            uf.join(["post:" + pid for pid in linked] + ["duplicate:" + family])
            self.mapped_near_duplicate_pairs += 1
        components: dict[str, list[str]] = defaultdict(list)
        for pid in self.posts:
            components[uf.find("post:" + pid)].append(pid)
        self.components: dict[str, list[str]] = {}
        self.post_component: dict[str, str] = {}
        for members in components.values():
            members.sort()
            cid = "component_" + canonical_sha256(members)[:24]
            self.components[cid] = members
            for pid in members:
                self.post_component[pid] = cid

    def exact_quote_ids(self, sentence: dict) -> list[str]:
        normalized = normalize_duplicate(sentence["text"])
        return sorted(q["id"] for q in self.quotes["headings"] + self.quotes["excerpts"]
                      if sentence["postId"] in q.get("sourcePostIds", [])
                      and len(normalize_duplicate(q.get("text", ""))) >= 8
                      and (normalize_duplicate(q.get("text", "")) in normalized or normalized in normalize_duplicate(q.get("text", ""))))

    def annotation(self, sentence_id: str) -> dict:
        if sentence_id not in self.sentences:
            raise DataError("UNKNOWN_SENTENCE_ID")
        sentence = self.sentences[sentence_id]
        pid = sentence["postId"]
        post = self.posts[pid]
        return {
            "schema_version": SCHEMA_VERSION,
            "pair_id": "human_" + sentence_id,
            "ordinary_text": "",
            "original_text": sentence["text"],
            "source": {
                "sentence_id": sentence_id,
                "post_id": pid,
                "post_url": post.get("postUrl"),
                "source_file": SOURCE_FILES[0],
                "source_sha256": self.hashes[SOURCE_FILES[0]],
                "catalog_sha256": canonical_sha256(self.hashes),
                "quote_ids": sorted(self.post_quotes[pid]),
                "exact_quote_ids": self.exact_quote_ids(sentence),
                "attribution": "unverified_archive_record_requires_human_review",
            },
            "lineage": {
                "original_post_ids": [pid],
                "variant_group_ids": sorted(self.post_variants[pid]),
                "leakage_group_ids": sorted(self.post_leakages[pid]),
                "duplicate_family_ids": sorted(self.post_duplicates[pid]),
                "component_id": self.post_component[pid],
                "additional_family_ids": [],
            },
            "context": {"original_post_text": post["content"], "thread_title": post.get("threadTitle", "")},
            "annotation": {"author_type": "", "annotator_id": "", "human_authored": False,
                           "no_llm_or_synthetic": False},
            "review": {"author_type": "", "no_llm_or_synthetic": False,
                       "reviewed": False, "reviewer_id": "", "meaning_preserved": False,
                       "source_verified": False, "lineage_reviewed": False},
        }


def export_annotations(repo: str | Path, output: str | Path, limit: int = 12) -> list[dict]:
    """Export a bounded blank batch, one source sentence per leakage component.

    Prefer literal heading/excerpt anchors in the same source post, then stable
    IDs. Exclude table-like rows and unbalanced excerpt boundaries. These are
    annotation-usability filters, not authorship or semantic-quality labels.
    """
    if type(limit) is not int or not 1 <= limit <= 200:
        raise DataError("ANNOTATION_LIMIT_MUST_BE_1_TO_200")
    catalog = SourceCatalog(repo)
    candidates = [row for row in catalog.sentences.values()
                  if 12 <= len(row["text"]) <= 120 and catalog.posts[row["postId"]].get("postUrl")
                  and not re.search(r"\s{2,}[0-9０-９]", row["text"])
                  and all(row["text"].count(a) == row["text"].count(b) for a,b in (("「","」"),("『","』"),("（","）"),("(",")")))]
    anchors = {row["id"]:catalog.exact_quote_ids(row) for row in candidates}
    candidates.sort(key=lambda row: (not any(q.startswith("heading_") for q in anchors[row["id"]]),
                                      not bool(anchors[row["id"]]), canonical_sha256(row["id"])))
    selected, seen = [], set()
    for row in candidates:
        group = catalog.post_component[row["postId"]]
        if group in seen:
            continue
        seen.add(group)
        selected.append(catalog.annotation(row["id"]))
        if len(selected) == limit:
            break
    if len(selected) < limit:
        raise DataError("INSUFFICIENT_DISTINCT_ANNOTATION_COMPONENTS")
    with Path(output).open("x", encoding="utf-8") as handle:
        for row in selected:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    return selected


def _require_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > MAX_TEXT_CHARS:
        raise DataError(label)
    return value


def _validate_human_attestations(row: dict) -> None:
    _require_text(row.get("ordinary_text"), "HUMAN_PARALLEL_DATA_REQUIRED")
    _require_text(row.get("original_text"), "ORIGINAL_TEXT_REQUIRED")
    _require_text(row.get("pair_id"), "PAIR_ID_REQUIRED")
    annotation, review = row.get("annotation"), row.get("review")
    if not isinstance(annotation, dict) or annotation.get("author_type") != "human":
        raise DataError("HUMAN_AUTHOR_REQUIRED: LLM, rules and synthetic teachers are prohibited")
    if set(annotation) != {"author_type", "annotator_id", "human_authored", "no_llm_or_synthetic"}:
        raise DataError("UNEXPECTED_ANNOTATION_FIELDS")
    _require_text(annotation.get("annotator_id"), "HUMAN_ANNOTATOR_ID_REQUIRED")
    for field in ("human_authored", "no_llm_or_synthetic"):
        if annotation.get(field) is not True:
            raise DataError("HUMAN_AUTHOR_ATTESTATION_REQUIRED: " + field)
    if not isinstance(review, dict):
        raise DataError("HUMAN_REVIEW_REQUIRED")
    if review.get("author_type") != "human" or review.get("no_llm_or_synthetic") is not True:
        raise DataError("HUMAN_REVIEWER_ATTESTATION_REQUIRED")
    if set(review) != {"author_type", "no_llm_or_synthetic", "reviewed", "reviewer_id", "meaning_preserved", "source_verified", "lineage_reviewed"}:
        raise DataError("UNEXPECTED_REVIEW_FIELDS")
    _require_text(review.get("reviewer_id"), "HUMAN_REVIEWER_ID_REQUIRED")
    for field in ("reviewed", "meaning_preserved", "source_verified", "lineage_reviewed"):
        if review.get(field) is not True:
            raise DataError("HUMAN_REVIEW_REQUIRED: " + field)


def _bounded_rows(rows: Iterable[dict]) -> list[dict]:
    materialized = []
    for row in rows:
        if not isinstance(row, dict):
            raise DataError("INVALID_ROW")
        materialized.append(row)
        if len(materialized) > MAX_PAIRS:
            raise DataError("TOO_MANY_PAIRS")
    if not materialized:
        raise DataError("HUMAN_PARALLEL_DATA_REQUIRED: verified human pairs = 0")
    return materialized


def validate_pairs(rows: Iterable[dict], repo: str | Path) -> list[dict]:
    """Reject incomplete/unauthored rows; verify exact local source provenance.

    Reviewers may add cross-post paraphrase/variant families in
    lineage.additional_family_ids, but may never remove computed relationships.
    No automatic inference supplies a human authorship or review attestation.
    """
    rows = _bounded_rows(rows)
    for row in rows:
        _validate_human_attestations(row)
    catalog = SourceCatalog(repo)
    seen = set()
    validated = []
    for row in rows:
        if row.get("schema_version") != SCHEMA_VERSION:
            raise DataError("UNSUPPORTED_SCHEMA")
        source = row.get("source")
        if not isinstance(source, dict):
            raise DataError("SOURCE_PROVENANCE_REQUIRED")
        expected = catalog.annotation(source.get("sentence_id"))
        if set(row) != set(expected):
            raise DataError("UNEXPECTED_ROW_FIELDS")
        for field in ("pair_id", "original_text", "source", "context"):
            if row.get(field) != expected[field]:
                raise DataError("SOURCE_PROVENANCE_MISMATCH: " + field)
        if row["pair_id"] in seen:
            raise DataError("DUPLICATE_PAIR_ID")
        seen.add(row["pair_id"])
        lineage = row.get("lineage")
        if not isinstance(lineage, dict) or set(lineage) != set(expected["lineage"]):
            raise DataError("LINEAGE_MISMATCH")
        for field, value in expected["lineage"].items():
            if field != "additional_family_ids" and lineage[field] != value:
                raise DataError("LINEAGE_MISMATCH: " + field)
        additional = lineage["additional_family_ids"]
        if not isinstance(additional, list) or len(additional) > 100:
            raise DataError("INVALID_ADDITIONAL_FAMILIES")
        if any(not isinstance(item, str) or not item.strip() or len(item) > 200 for item in additional):
            raise DataError("INVALID_ADDITIONAL_FAMILIES")
        if len(set(additional)) != len(additional):
            raise DataError("DUPLICATE_ADDITIONAL_FAMILY_ID")
        validated.append(copy.deepcopy(row))
    return sorted(validated, key=lambda row: row["pair_id"])


def _pair_components(rows: list[dict]) -> list[dict]:
    uf = _UnionFind()
    seen = set()
    for row in rows:
        _validate_human_attestations(row)
        pair_id = row["pair_id"]
        if pair_id in seen:
            raise DataError("DUPLICATE_PAIR_ID")
        seen.add(pair_id)
        lineage = row.get("lineage")
        if not isinstance(lineage, dict) or not lineage.get("component_id"):
            raise DataError("SOURCE_LINEAGE_REQUIRED")
        nodes = ["pair:" + pair_id, "component:" + lineage["component_id"]]
        for field in ("original_post_ids", "variant_group_ids", "leakage_group_ids",
                      "duplicate_family_ids", "additional_family_ids"):
            if not isinstance(lineage.get(field), list):
                raise DataError("SOURCE_LINEAGE_REQUIRED: " + field)
            nodes.extend(field + ":" + item for item in lineage[field])
        # Use one namespace across both sides: reversals and identical source/
        # target strings also stay together. This intentionally over-groups.
        nodes.extend("text:" + canonical_sha256(normalize_duplicate(row[field]))
                     for field in ("ordinary_text", "original_text"))
        uf.join(nodes)
    grouped: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        grouped[uf.find("pair:" + row["pair_id"])].append(row["pair_id"])
    return sorted(({"component_id": "pairs_" + canonical_sha256(sorted(ids))[:24],
                    "pair_ids": sorted(ids)} for ids in grouped.values()),
                  key=lambda group: group["component_id"])


def _input_hash(rows: list[dict]) -> str:
    return canonical_sha256(sorted(rows, key=lambda row: row["pair_id"]))


def make_split(validated: Iterable[dict], seed: str | int, train_ratio: float = 0.8) -> dict:
    """Freeze group split before model fitting; tiny minima are wiring only."""
    rows = _bounded_rows(validated)
    if isinstance(train_ratio, bool) or not isinstance(train_ratio, (int, float)) or not math.isfinite(train_ratio) or not 0 < train_ratio < 1:
        raise DataError("INVALID_TRAIN_RATIO")
    if isinstance(seed, bool) or not isinstance(seed, (str, int)):
        raise DataError("INVALID_SPLIT_SEED")
    components = _pair_components(rows)
    if len(components) < 3:
        raise DataError("INSUFFICIENT_INDEPENDENT_COMPONENTS: at least 3 required for wiring")
    ranked = sorted(components, key=lambda group: canonical_sha256([str(seed), group["component_id"]]))
    count = len(ranked)
    n_train = min(count - 2, max(1, int(count * train_ratio)))
    n_dev = max(1, (count - n_train) // 2)
    assignments = {}
    for index, component in enumerate(ranked):
        split = "train" if index < n_train else "dev" if index < n_train + n_dev else "test"
        component["split"] = split
        assignments.update({pid: split for pid in component["pair_ids"]})
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "input_sha256": _input_hash(rows),
        "seed": str(seed),
        "train_ratio": train_ratio,
        "components": sorted(ranked, key=lambda group: group["component_id"]),
        "assignments": dict(sorted(assignments.items())),
        "counts": {split: sum(value == split for value in assignments.values()) for split in SPLITS},
        "component_counts": {split: sum(group["split"] == split for group in ranked) for split in SPLITS},
        "quality_status": "research_wiring_only_no_quality_adequacy_claim",
        "leakage_scope": "exact-normalized texts and declared/full-corpus source lineage; unrecognized semantic duplicates require human lineage review",
    }
    validate_split(rows, manifest)
    return manifest


def validate_split(rows: Iterable[dict], manifest: dict) -> dict[str, list[dict]]:
    """Verify exact frozen data and all declared relationships before training."""
    rows = _bounded_rows(rows)
    if not isinstance(manifest, dict) or manifest.get("schema_version") != SCHEMA_VERSION:
        raise DataError("INVALID_SPLIT_MANIFEST")
    if manifest.get("input_sha256") != _input_hash(rows):
        raise DataError("FROZEN_INPUT_HASH_MISMATCH")
    assignments = manifest.get("assignments")
    ids = {row["pair_id"] for row in rows}
    if not isinstance(assignments, dict) or set(assignments) != ids or any(value not in SPLITS for value in assignments.values()):
        raise DataError("INVALID_SPLIT_ASSIGNMENTS")
    components = _pair_components(rows)
    if len(components) < 3:
        raise DataError("INSUFFICIENT_INDEPENDENT_COMPONENTS")
    expected = []
    for component in components:
        splits = {assignments[pid] for pid in component["pair_ids"]}
        if len(splits) != 1:
            raise DataError("CROSS_SPLIT_LEAKAGE")
        expected.append({**component, "split": next(iter(splits))})
    if manifest.get("components") != expected:
        raise DataError("SPLIT_COMPONENT_MISMATCH")
    partitions = {split: [row for row in rows if assignments[row["pair_id"]] == split] for split in SPLITS}
    if any(not group for group in partitions.values()):
        raise DataError("EMPTY_SPLIT")
    if manifest.get("counts") != {split: len(group) for split, group in partitions.items()}:
        raise DataError("SPLIT_COUNT_MISMATCH")
    if manifest.get("component_counts") != {split: sum(group["split"] == split for group in expected) for split in SPLITS}:
        raise DataError("SPLIT_COMPONENT_COUNT_MISMATCH")
    return partitions


def audit_sources(repo: str | Path) -> dict:
    """Inventory repository originals; it deliberately does not infer human pairs."""
    catalog = SourceCatalog(repo)
    quotes = catalog.quotes["headings"] + catalog.quotes["excerpts"]
    annotations_dir = Path(repo) / "assets/annotations"
    files = sorted(str(path.relative_to(repo)) for path in annotations_dir.glob("*") if path.is_file())
    return {
        "schema_version": SCHEMA_VERSION,
        "verified_human_parallel_pairs": 0,
        "pair_audit_scope": "tracked repository source assets and inspected PR6 evaluation/provenance artifacts; no imported human annotation file supplied",
        "training_status": "BLOCKED_HUMAN_PARALLEL_DATA_REQUIRED",
        "source_file_sha256": catalog.hashes,
        "archive_post_records": len(catalog.posts),
        "archive_source_sentences": len(catalog.sentences),
        "archive_posts_with_url": sum(bool(row.get("postUrl")) for row in catalog.posts.values()),
        "archive_normalized_unique_posts": len({normalize_duplicate(row["content"]) for row in catalog.posts.values()}),
        "archive_normalized_unique_sentences": len({normalize_duplicate(row["text"]) for row in catalog.sentences.values()}),
        "quote_headings": len(catalog.quotes["headings"]),
        "quote_excerpts": len(catalog.quotes["excerpts"]),
        "quote_variant_groups": len(catalog.quotes["quoteGroups"]),
        "quote_linked_source_posts": len(catalog.quotes["sourcePosts"]),
        "quote_page_posts": len(catalog.quotes["pagePosts"]),
        "quote_context_status": dict(sorted(Counter(row.get("contextMatch", {}).get("status", "unknown") for row in quotes).items())),
        "mapped_existing_near_duplicate_pairs": catalog.mapped_near_duplicate_pairs,
        "full_corpus_leakage_components": len(catalog.components),
        "largest_component_posts": max(map(len, catalog.components.values())),
        "annotation_assets": files,
        "excluded_teacher_sources": [
            "Current rules and generated outputs: synthetic teachers, not human ordinary/original pairs",
            "PR6 open-style probes: explicitly assistant-authored; generated outputs and qualitative review excluded",
            "PR6 prospective/heldout cases: explicitly synthetic semantic probes; human S/Q null",
            "Existing regression/pilot/preferences fixtures: test data, not human gold",
            "Novel adaptations: derivative works, not original-post parallel data",
            "Quote family labels: heuristic_lexical_cues with goldLabels=false",
        ],
        "cautions": [
            "Archive records contain mixed or unverified speaker attribution and duplicates; counts are not authenticated Buront authorship",
            "Quotes and original posts are target-side monolingual material, not aligned ordinary-Japanese pairs",
            "Human ordinary rewrite, original attribution/meaning review and additional duplicate-family review are still required",
            "Attestation flags enforce a contract but cannot detect a false declaration of human authorship",
            "Data remains local-only; existing rights status is unverified-local-only; no corpus upload or redistribution approval implied",
            "Group split is conservative over known source/variant/exact/near duplicate links, not proof of absence of every semantic duplicate",
            "At least three independent groups enables plumbing tests only; it is not evidence of data sufficiency or quality improvement",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("audit")
    export = sub.add_parser("export")
    export.add_argument("output", type=Path)
    export.add_argument("--limit", type=int, default=12)
    split = sub.add_parser("split")
    split.add_argument("annotations", type=Path)
    split.add_argument("output", type=Path)
    split.add_argument("--seed", default="buront-statistical-research-v1")
    args = parser.parse_args(argv)
    try:
        if args.command == "audit":
            print(json.dumps(audit_sources(args.repo), ensure_ascii=False, indent=2))
        elif args.command == "export":
            rows = export_annotations(args.repo, args.output, args.limit)
            print(json.dumps({"blank_rows": len(rows), "usable_human_pairs": 0, "output": str(args.output)}))
        else:
            rows = validate_pairs(load_annotations(args.annotations), args.repo)
            manifest = make_split(rows, args.seed)
            with args.output.open("x", encoding="utf-8") as handle:
                json.dump(manifest, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            print(json.dumps(manifest["counts"]))
    except (DataError, OSError) as exc:
        parser.exit(2, str(exc) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
