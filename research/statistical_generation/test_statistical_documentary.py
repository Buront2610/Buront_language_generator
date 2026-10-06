"""Mechanical documentary contract fixtures, never human quality examples.

The made-up attribution metadata exercises validation only. All body strings are
nonlinguistic sentinels; no human semantic-review or quality labels are invented.
"""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from research.statistical_generation.data import DataError, canonical_sha256, validate_pairs
from research.statistical_generation.documentary import (
    MODE, SOURCE_KIND, load_documentary_pairs, make_documentary_split,
    validate_documentary_pairs, validate_documentary_split,
)


class DocumentaryContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.cache = self.root / "private-cache"
        self.cache.mkdir()
        self.manifest_path = self.cache / "manifest.json"
        self.manifest = {"schema_version": 1, "mode": MODE, "scope": "local_research_only",
                         "source_kind": SOURCE_KIND, "documents": [], "works": [], "pairs": []}
        for index in range(6):
            source_id, target_id = f"source_{index}", f"adaptation_{index}"
            source_text, target_text = f"SRC_SENTINEL_{index}_α", f"TGT_SENTINEL_{index}_β"
            self.add_document(source_id, "PREFIX\n" + source_text + "\nEND")
            self.add_document(target_id, "PREFIX\n" + target_text + "\nEND")
            self.manifest["works"].append({
                "work_id": f"work_{index}", "title": f"WORK_SENTINEL_{index}",
                "original_author": "TEST_ONLY_ATTRIBUTION_SENTINEL",
                "source_document_ids": [source_id], "adaptation_document_ids": [target_id],
                "relationship_evidence": {"url": f"https://example.invalid/work/{index}",
                                           "notes": "Mechanical metadata fixture; not historical evidence"},
                "version_status": "uncertain", "family_ids": [],
            })
            self.manifest["pairs"].append({
                "work_id": f"work_{index}",
                "source": {"document_id": source_id, "start": 7, "end": 7 + len(source_text)},
                "target": {"document_id": target_id, "start": 7, "end": 7 + len(target_text)},
                "alignment": {"method": "tool", "notes": "Mechanical fixture offsets only"},
                "semantic_review_status": "unreviewed", "human_review": None,
            })
        self.save()

    def add_document(self, document_id, text):
        raw = ("RAW_CAPTURE_SENTINEL\n" + text).encode("utf-8")
        raw_path, text_path = self.cache / (document_id + ".raw"), self.cache / (document_id + ".txt")
        raw_path.write_bytes(raw)
        text_path.write_bytes(text.encode("utf-8"))
        document = {
            "document_id": document_id, "url": f"https://example.invalid/{document_id}",
            "title": document_id, "version": "TEST_ONLY_VERSION_SENTINEL", "retrieved_at": "2026-10-06T00:00:00Z",
            "raw_path": raw_path.name, "raw_sha256": hashlib.sha256(raw).hexdigest(),
            "raw_kind": "http_response_body", "text_path": text_path.name,
            "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "extraction": {"method": "fixture", "notes": "Mechanical fixture; no real publication"},
            "authorship_evidence": {"status": "published_human_attributed", "author": "TEST_ONLY_ATTRIBUTION_SENTINEL",
                                    "evidence_url": f"https://example.invalid/{document_id}",
                                    "notes": "Made-up contract metadata, not authentication or human review"},
            "rights": {"status": "unknown", "notes": "Mechanical fixture. No rights clearance claim",
                       "redistribution_allowed": False},
        }
        self.manifest["documents"].append(document)
        return document

    def save(self):
        self.manifest_path.write_text(json.dumps(self.manifest, ensure_ascii=False), encoding="utf-8")

    def rows(self):
        self.save()
        return load_documentary_pairs(self.manifest_path, self.repo)

    def assert_invalid_manifest(self, pattern=None):
        if pattern:
            with self.assertRaisesRegex(DataError, pattern):
                self.rows()
        else:
            with self.assertRaises(DataError):
                self.rows()

    def test_exact_codepoint_spans_and_no_human_gold_claims(self):
        rows = self.rows()
        self.assertEqual(len(rows), 6)
        for row in rows:
            index = row["source"]["work"]["work_id"].split("_")[-1]
            self.assertEqual(row["ordinary_text"], f"SRC_SENTINEL_{index}_α")
            self.assertEqual(row["original_text"], f"TGT_SENTINEL_{index}_β")
            self.assertEqual(row["mode"], MODE)
            self.assertEqual(row["source_kind"], SOURCE_KIND)
            self.assertEqual(row["semantic_review_status"], "unreviewed")
            self.assertIsNone(row["human_review"])
            self.assertEqual(row["source"]["original"]["offset_unit"], "unicode_codepoint")
            self.assertTrue(Path(row["source"]["original_document"]["text_path"]).is_absolute())
            for field in ("human_gold", "annotation", "review", "meaning_preserved"):
                self.assertNotIn(field, row)
        self.assertEqual(rows, validate_documentary_pairs(rows, self.manifest_path, self.repo))
        with self.assertRaises(DataError):
            validate_pairs(rows, self.repo)

    def test_unreviewed_flags_cannot_be_promoted(self):
        original = copy.deepcopy(self.manifest)
        for field, value in (("semantic_review_status", "human_reviewed"), ("human_review", {}),
                             ("human_gold", True), ("meaning_preserved", True), ("ordinary_text", "INLINE_SENTINEL")):
            self.manifest = copy.deepcopy(original)
            self.manifest["pairs"][0][field] = value
            self.assert_invalid_manifest()

    def test_raw_and_text_hashes_are_verified(self):
        for kind in ("raw", "text"):
            path = self.cache / self.manifest["documents"][0][kind + "_path"]
            old = path.read_bytes()
            path.write_bytes(old + b"EDIT")
            with self.assertRaisesRegex(DataError, "SOURCE_HASH_MISMATCH"):
                load_documentary_pairs(self.manifest_path, self.repo)
            path.write_bytes(old)

    def test_unused_document_bytes_and_metadata_bound(self):
        unused = self.add_document("unused", "UNUSED_SENTINEL")
        rows = self.rows()
        split = make_documentary_split(rows, "seed")
        self.assertIn("unused", split["document_hashes"])
        self.manifest["documents"][-1]["version"] = "CHANGED_VERSION_SENTINEL"
        changed_rows = self.rows()
        with self.assertRaisesRegex(DataError, "FROZEN_DOCUMENTARY_INPUT_HASH_MISMATCH"):
            validate_documentary_split(changed_rows, split, self.manifest_path, self.repo)
        (self.cache / unused["raw_path"]).write_bytes(b"CHANGED_RAW")
        with self.assertRaisesRegex(DataError, "SOURCE_HASH_MISMATCH"):
            load_documentary_pairs(self.manifest_path, self.repo)

    def test_no_inline_assistant_text_or_generated_authorship(self):
        for author in ("assistant", "LLM", "synthetic", "ChatGPT"):
            self.manifest["documents"][0]["authorship_evidence"]["author"] = author
            self.assert_invalid_manifest("GENERATED_DOCUMENTARY_TEACHERS_FORBIDDEN")
        self.manifest["documents"][0]["authorship_evidence"]["author"] = "TEST_ONLY_ATTRIBUTION_SENTINEL"
        self.manifest["documents"][0]["authorship_evidence"]["status"] = "assistant_authored"
        self.assert_invalid_manifest("PUBLISHED_HUMAN_AUTHORSHIP_EVIDENCE_REQUIRED")

    def test_rights_unknown_is_allowed_but_redistribution_not(self):
        self.assertEqual(len(self.rows()), 6)
        for value in (True, 0, "false", None):
            self.manifest["documents"][0]["rights"]["redistribution_allowed"] = value
            self.assert_invalid_manifest("LOCAL_ONLY_RIGHTS")

    def test_missing_rights_or_provenance_rejected(self):
        original = copy.deepcopy(self.manifest)
        for field in ("rights", "authorship_evidence", "extraction", "version", "raw_sha256", "text_sha256"):
            self.manifest = copy.deepcopy(original)
            del self.manifest["documents"][0][field]
            self.assert_invalid_manifest()

    def test_raw_capture_kind_is_honest_and_disclosed(self):
        self.manifest["documents"][0]["raw_kind"] = "web_tool_capture"
        row = next(r for r in self.rows() if r["source"]["work"]["work_id"] == "work_0")
        self.assertEqual(row["source"]["original_document"]["raw_kind"], "web_tool_capture")
        self.manifest["documents"][0]["raw_kind"] = "invented_html"
        self.assert_invalid_manifest("RAW_CAPTURE_KIND")

    def test_repository_files_and_symlinks_rejected(self):
        doc = self.manifest["documents"][0]
        inside = self.repo / "protected.txt"
        inside.write_bytes((self.cache / doc["text_path"]).read_bytes())
        doc["text_path"] = str(inside)
        self.assert_invalid_manifest("OUTSIDE_REPOSITORY")
        link = self.cache / "inside-link.txt"
        link.symlink_to(inside)
        doc["text_path"] = str(link)
        self.assert_invalid_manifest("OUTSIDE_REPOSITORY")
        with self.assertRaisesRegex(DataError, "OUTSIDE_REPOSITORY"):
            load_documentary_pairs(self.repo / "manifest.json", self.repo)

    def test_invalid_span_types_ranges_and_hashes(self):
        original = copy.deepcopy(self.manifest["pairs"][0]["source"])
        for field, value in (("start", True), ("start", -1), ("end", 999999), ("end", 1),
                             ("document_id", "missing"), ("sha256_utf8", "0" * 64)):
            self.manifest["pairs"][0]["source"] = {**original, field: value}
            self.assert_invalid_manifest()
        self.manifest["pairs"][0]["source"] = original
        self.manifest["pairs"][0]["source"]["text"] = "INLINE_SENTINEL"
        self.assert_invalid_manifest("INVALID_DOCUMENTARY_SPAN")

    def test_pair_work_roles_are_checked(self):
        self.manifest["pairs"][0]["source"]["document_id"] = "source_1"
        self.assert_invalid_manifest("WORK_DOCUMENT_MISMATCH")

    def test_stable_ids_optional_evidence_does_not_rename_pairs(self):
        rows = self.rows()
        by_work = {r["source"]["work"]["work_id"]: r for r in rows}
        span = self.manifest["pairs"][0]["source"]
        text = (self.cache / "source_0.txt").read_text(encoding="utf-8")[span["start"]:span["end"]]
        span["sha256_utf8"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
        span["web_lines_inclusive"] = [10, 11]
        self.manifest["pairs"][0]["pair_id"] = by_work["work_0"]["pair_id"]
        self.manifest["pairs"][0]["known_semantic_deviation"] = "MECHANICAL_WARNING_SENTINEL"
        self.manifest["pairs"][0]["notes"] = ["Parent passage sentinel", "No language claims"]
        changed = self.rows()
        self.assertEqual([r["pair_id"] for r in rows], [r["pair_id"] for r in changed])
        row = next(r for r in changed if r["source"]["work"]["work_id"] == "work_0")
        self.assertEqual(row["source"]["pair_metadata"]["known_semantic_deviation"], "MECHANICAL_WARNING_SENTINEL")
        self.assertNotEqual(rows[0]["source"]["manifest_sha256"], changed[0]["source"]["manifest_sha256"])

    def test_duplicate_manifest_ids_and_pairs_rejected(self):
        original = copy.deepcopy(self.manifest)
        for section in ("documents", "works", "pairs"):
            self.manifest = copy.deepcopy(original)
            self.manifest[section].append(copy.deepcopy(self.manifest[section][0]))
            self.assert_invalid_manifest("DUPLICATE_DOCUMENTARY")

    def test_deterministic_whole_work_split_and_variants(self):
        variant = self.add_document("variant", "ANOTHER_TARGET_SENTINEL")
        self.manifest["works"][0]["adaptation_document_ids"].append("variant")
        pair = copy.deepcopy(self.manifest["pairs"][0])
        pair["target"] = {"document_id": "variant", "start": 0, "end": len("ANOTHER_TARGET_SENTINEL")}
        self.manifest["pairs"].append(pair)
        rows = self.rows()
        split = make_documentary_split(rows, "frozen-seed")
        self.assertEqual(split, make_documentary_split(reversed(rows), "frozen-seed"))
        variant_rows = [r for r in rows if r["lineage"]["work_id"] == "work_0"]
        self.assertEqual(len({split["assignments"][r["pair_id"]] for r in variant_rows}), 1)
        self.assertEqual(split["component_counts"], {"train": 4, "dev": 1, "test": 1})
        partitions = validate_documentary_split(rows, split, self.manifest_path, self.repo)
        self.assertTrue(all(partitions.values()))

    def test_normalized_cross_side_duplicates_join_work_families(self):
        # Mechanical fullwidth/case/whitespace variation on the opposite side.
        text = "ＳＲＣ＿ＳＥＮＴＩＮＥＬ＿０＿α  "
        doc = self.manifest["documents"][3]
        path = self.cache / doc["text_path"]
        path.write_text(text, encoding="utf-8")
        doc["text_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.manifest["pairs"][1]["target"] = {"document_id": doc["document_id"], "start": 0, "end": len(text)}
        rows = self.rows()
        groups = {r["lineage"]["work_id"]: r["lineage"]["component_id"] for r in rows}
        self.assertEqual(groups["work_0"], groups["work_1"])
        self.assertEqual(len(set(groups.values())), 5)

    def test_title_author_alias_and_declared_family_are_grouped(self):
        self.manifest["works"][1]["title"] = self.manifest["works"][0]["title"]
        self.manifest["works"][2]["family_ids"] = ["same_original_family"]
        self.manifest["works"][3]["family_ids"] = ["same_original_family"]
        rows = self.rows()
        groups = {r["lineage"]["work_id"]: r["lineage"]["component_id"] for r in rows}
        self.assertEqual(groups["work_0"], groups["work_1"])
        self.assertEqual(groups["work_2"], groups["work_3"])
        self.assertEqual(len(set(groups.values())), 4)

    def test_at_least_three_independent_work_components_required(self):
        for work in self.manifest["works"]:
            work["family_ids"] = ["same_original_family"]
        rows = self.rows()
        with self.assertRaisesRegex(DataError, "INSUFFICIENT_INDEPENDENT_DOCUMENTARY_WORK_COMPONENTS"):
            make_documentary_split(rows, "seed")

    def test_frozen_split_binds_all_rows_and_rechecks_sources(self):
        rows = self.rows()
        split = make_documentary_split(rows, "seed")
        for field, value in (("ordinary_text", "CHANGED_SENTINEL"), ("alignment", {"method": "assistant", "notes": "Changed"})):
            changed = copy.deepcopy(rows)
            changed[0][field] = value
            with self.assertRaisesRegex(DataError, "DERIVED_RECORD_MISMATCH"):
                validate_documentary_split(changed, split, self.manifest_path, self.repo)
        (self.cache / "source_0.raw").write_bytes(b"EDIT")
        with self.assertRaisesRegex(DataError, "SOURCE_HASH_MISMATCH"):
            validate_documentary_split(rows, split, self.manifest_path, self.repo)

    def test_frozen_split_metadata_and_assignments_cannot_change(self):
        rows = self.rows()
        split = make_documentary_split(rows, "seed")
        for key, value in (("seed", "different-seed"), ("quality_status", "human_gold"),
                           ("source_manifest_sha256", "0" * 64), ("counts", {})):
            changed = {**split, key: value}
            with self.assertRaisesRegex(DataError, "SPLIT_MANIFEST_MISMATCH"):
                validate_documentary_split(rows, changed)
        changed = copy.deepcopy(split)
        changed["assignments"][rows[0]["pair_id"]] = "unrecognized"
        with self.assertRaises(DataError):
            validate_documentary_split(rows, changed)

    def test_subset_duplicate_or_fabricated_rows_not_accepted(self):
        rows = self.rows()
        with self.assertRaisesRegex(DataError, "FULL_RECORD_SET_REQUIRED"):
            make_documentary_split(rows[:-1], "seed")
        with self.assertRaisesRegex(DataError, "DUPLICATE_DOCUMENTARY_PAIR"):
            make_documentary_split(rows + [rows[0]], "seed")
        changed = copy.deepcopy(rows)
        changed[0]["lineage"]["component_id"] = "FAKE"
        with self.assertRaisesRegex(DataError, "LINEAGE_MISMATCH"):
            make_documentary_split(changed, "seed")
        changed = copy.deepcopy(rows)
        changed[0]["human_gold"] = True
        with self.assertRaises(DataError):
            make_documentary_split(changed, "seed")

    def test_known_source_worker_metadata_roundtrips_without_gold(self):
        self.manifest["created_at"] = "2026-10-06T00:00:00Z"
        self.manifest["purpose"] = "MECHANICAL_PROVENANCE_FIXTURE"
        self.manifest["notes"] = ["Sentinel metadata"]
        self.manifest["documents"][0]["extraction"]["source_body_lines"] = [100, 200]
        self.manifest["documents"][0]["notes"] = ["Sentinel document note"]
        self.manifest["documents"][0]["rights"]["evidence_url"] = "https://example.invalid/rights"
        self.manifest["works"][0]["notes"] = ["Sentinel work note"]
        self.manifest["pairs"][0]["alignment"]["event_label"] = "EVENT_SENTINEL"
        self.manifest["pairs"][0]["target"]["html_p_ids_inclusive"] = [1, 2]
        self.manifest["pairs"][0]["known_semantic_deviation"] = None
        rows = self.rows()
        row = next(r for r in rows if r["source"]["work"]["work_id"] == "work_0")
        self.assertEqual(row["alignment"]["event_label"], "EVENT_SENTINEL")
        self.assertEqual(row["source"]["original_document"]["extraction"]["source_body_lines"], [100, 200])
        self.assertEqual(row["source"]["adaptation"]["html_p_ids_inclusive"], [1, 2])
        self.assertIsNone(row["source"]["pair_metadata"]["known_semantic_deviation"])
        split = make_documentary_split(rows, "seed")
        self.assertEqual(split["quality_status"], "documentary_research_unreviewed_no_quality_claim")
        self.assertEqual(validate_documentary_pairs(rows, self.manifest_path, self.repo), rows)
        self.manifest["documents"][0]["extraction"]["source_body_lines"] = [True, 2]
        self.assert_invalid_manifest("INVALID_DOCUMENTARY_EXTRACTION_LINES")
        self.manifest["documents"][0]["extraction"]["source_body_lines"] = [1, 2]
        self.manifest["pairs"][0]["target"]["html_p_ids_inclusive"] = [3, 2]
        self.assert_invalid_manifest("INVALID_DOCUMENTARY_CAPTURE_LOCATOR")

    def test_scope_and_bounds_not_coerced(self):
        for value in (True, 0, "1"):
            self.manifest["schema_version"] = value
            self.assert_invalid_manifest("UNSUPPORTED_DOCUMENTARY_SCHEMA")
        self.manifest["schema_version"] = 1
        rows = self.rows()
        for value in (True, 0, 1, float("nan"), float("inf"), "0.8"):
            with self.assertRaises(DataError):
                make_documentary_split(rows, "seed", value)
        for value in (True, None, []):
            with self.assertRaises(DataError):
                make_documentary_split(rows, value)
        with self.assertRaises(DataError):
            make_documentary_split([], "seed")


if __name__ == "__main__":
    unittest.main()
