"""Contract tests using nonlinguistic sentinels; never human training examples."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from research.statistical_generation.data import (
    DataError, SourceCatalog, audit_sources, canonical_sha256, export_annotations,
    load_annotations, make_split, normalize_duplicate, validate_pairs, validate_split,
)


class StatisticalDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.log = {"posts": [], "sentences": []}
        for index in range(10):
            post_id = f"p{index}"
            text = f"TARGET_SENTINEL_{index:03d}"
            self.log["posts"].append({"id": post_id, "content": text,
                                      "postUrl": f"https://example.invalid/thread/{index}",
                                      "threadTitle": "Test fixtures, not source evidence"})
            self.log["sentences"].append({"id": f"s{index}", "postId": post_id, "text": text})
        self.quotes = {"headings": [], "excerpts": [], "sourcePosts": [], "quoteGroups": [], "pagePosts": []}
        self.raw = []
        self.near = []
        self.write_sources()

    def write_sources(self):
        files = {
            "data/log-corpus.json": json.dumps(self.log),
            "data/quote-corpus.json": json.dumps(self.quotes),
            "artifacts/fulltext-analysis-20260921/posts.jsonl": "\n".join(json.dumps(row) for row in self.raw),
            "artifacts/fulltext-analysis-20260921/near-duplicates.json": json.dumps(self.near),
        }
        for filename, value in files.items():
            path = self.repo / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value, encoding="utf-8")

    def fixture_rows(self, ids=None):
        """Fabricated positive contract flags, not real annotations or gold data."""
        catalog = SourceCatalog(self.repo)
        rows = []
        for index, sentence_id in enumerate(ids or catalog.sentences):
            row = catalog.annotation(sentence_id)
            row["ordinary_text"] = f"ORDINARY_TEST_SENTINEL_{index:03d}"
            row["annotation"] = {"author_type": "human", "annotator_id": "TEST_ONLY_FAKE_DECLARATION",
                                 "human_authored": True, "no_llm_or_synthetic": True}
            row["review"] = {"author_type": "human", "no_llm_or_synthetic": True, "reviewed": True, "reviewer_id": "TEST_ONLY_FAKE_DECLARATION",
                             "meaning_preserved": True, "source_verified": True, "lineage_reviewed": True}
            rows.append(row)
        return validate_pairs(rows, self.repo)

    def test_blank_export_never_creates_teacher_or_attestation(self):
        path = self.repo / "blank.jsonl"
        rows = export_annotations(self.repo, path, limit=5)
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows, load_annotations(path))
        self.assertEqual(len({row["lineage"]["component_id"] for row in rows}), 5)
        for row in rows:
            self.assertEqual(row["ordinary_text"], "")
            self.assertFalse(row["annotation"]["human_authored"])
            self.assertFalse(row["annotation"]["no_llm_or_synthetic"])
            self.assertFalse(row["review"]["reviewed"])
        with self.assertRaisesRegex(DataError, "HUMAN_PARALLEL_DATA_REQUIRED"):
            validate_pairs(rows, self.repo)
        with self.assertRaises(FileExistsError):
            export_annotations(self.repo, path, limit=5)

    def test_export_prefers_direct_quote_anchors_and_excludes_table_fragments(self):
        self.quotes["headings"] = [{"id":"heading_1","text":self.log["sentences"][9]["text"],"sourcePostIds":["p9"]}]
        for i,text in ((0,"TABLE_SENTINEL     １２３   ４５"),(1,"UNBALANCED_SENTINEL」")):
            self.log["posts"][i]["content"] = text
            self.log["sentences"][i]["text"] = text
        self.write_sources()
        rows = export_annotations(self.repo,self.repo/"filtered.jsonl",5)
        self.assertEqual(rows[0]["source"]["sentence_id"],"s9")
        self.assertEqual(rows[0]["source"]["exact_quote_ids"],["heading_1"])
        self.assertFalse({"s0","s1"} & {r["source"]["sentence_id"] for r in rows})

    def test_blank_limit_is_bounded(self):
        for value in [0, 201, True, 2.5]:
            with self.subTest(value=value), self.assertRaises(DataError):
                export_annotations(self.repo, self.repo / "unused", value)

    def test_no_data_fails_fast(self):
        with self.assertRaisesRegex(DataError, "verified human pairs = 0"):
            validate_pairs([], self.repo)
        with self.assertRaises(DataError):
            make_split([], "seed")

    def test_rejects_nonhuman_unreviewed_or_missing_attestations(self):
        rows = self.fixture_rows()
        for author in ["llm", "assistant", "synthetic", "rule", "human-assisted", ""]:
            row = copy.deepcopy(rows[0])
            row["annotation"]["author_type"] = author
            with self.subTest(author=author), self.assertRaisesRegex(DataError, "HUMAN_AUTHOR_REQUIRED"):
                validate_pairs([row], self.repo)
        for author in ["llm", "assistant", "synthetic", ""]:
            row = copy.deepcopy(rows[0])
            row["review"]["author_type"] = author
            with self.subTest(reviewer_type=author), self.assertRaisesRegex(DataError, "HUMAN_REVIEWER_ATTESTATION_REQUIRED"):
                validate_pairs([row], self.repo)
        for section, fields in [("annotation", ("human_authored", "no_llm_or_synthetic")),
                                ("review", ("no_llm_or_synthetic", "reviewed", "meaning_preserved", "source_verified", "lineage_reviewed"))]:
            for field in fields:
                for invalid in [False, 1, "true", None]:
                    row = copy.deepcopy(rows[0])
                    row[section][field] = invalid
                    with self.subTest(section=section, field=field, invalid=invalid), self.assertRaises(DataError):
                        validate_pairs([row], self.repo)

    def test_text_length_and_undeclared_authorship_fields_rejected(self):
        rows = self.fixture_rows()
        row = copy.deepcopy(rows[0])
        row["ordinary_text"] = "A" * 5001
        with self.assertRaises(DataError):
            validate_pairs([row], self.repo)
        for section in ("annotation", "review"):
            row = copy.deepcopy(rows[0])
            row[section]["generator"] = "LLM"
            with self.subTest(section=section), self.assertRaises(DataError):
                validate_pairs([row], self.repo)

    def test_original_source_and_context_cannot_be_changed(self):
        rows = self.fixture_rows()
        for section, key, value in [(None, "original_text", "ALTERED"),
                                    (None, "pair_id", "NEW_ID"),
                                    ("source", "source_sha256", "BAD_HASH"),
                                    ("source", "post_url", "https://wrong.invalid"),
                                    ("context", "original_post_text", "ALTERED"),
                                    ("lineage", "component_id", "LIE")]:
            row = copy.deepcopy(rows[0])
            (row if section is None else row[section])[key] = value
            with self.subTest(section=section, key=key), self.assertRaises(DataError):
                validate_pairs([row], self.repo)

    def test_source_file_changes_invalidate_export(self):
        rows = self.fixture_rows()
        self.log["posts"][1]["threadTitle"] = "Changed metadata"
        self.write_sources()
        with self.assertRaisesRegex(DataError, "SOURCE_PROVENANCE_MISMATCH"):
            validate_pairs(rows, self.repo)

    def test_additional_families_are_supported_but_bad_values_rejected(self):
        rows = self.fixture_rows()
        rows[0]["lineage"]["additional_family_ids"] = ["human-discovered-family"]
        rows[1]["lineage"]["additional_family_ids"] = ["human-discovered-family"]
        rows = validate_pairs(rows, self.repo)
        manifest = make_split(rows, "seed")
        self.assertEqual(manifest["assignments"][rows[0]["pair_id"]], manifest["assignments"][rows[1]["pair_id"]])
        for invalid in [["x", "x"], [""], [1], "family"]:
            changed = copy.deepcopy(rows)
            changed[0]["lineage"]["additional_family_ids"] = invalid
            with self.subTest(invalid=invalid), self.assertRaises(DataError):
                validate_pairs(changed, self.repo)

    def test_split_is_deterministic_and_nonempty(self):
        rows = self.fixture_rows()
        manifest = make_split(rows, "seed")
        self.assertEqual(manifest, make_split(reversed(rows), "seed"))
        self.assertEqual(manifest["component_counts"], {"train": 8, "dev": 1, "test": 1})
        self.assertEqual(sum(manifest["counts"].values()), len(rows))
        parts = validate_split(rows, manifest)
        self.assertTrue(all(parts.values()))
        self.assertEqual(make_split(rows[:3], "seed")["counts"], {"train": 1, "dev": 1, "test": 1})
        with self.assertRaisesRegex(DataError, "INSUFFICIENT_INDEPENDENT_COMPONENTS"):
            make_split(rows[:2], "seed")

    def test_split_rejects_invalid_seed_and_ratios(self):
        rows = self.fixture_rows()
        for ratio in [0, 1, -1, float("nan"), float("inf"), True]:
            with self.subTest(ratio=ratio), self.assertRaises(DataError):
                make_split(rows, "seed", train_ratio=ratio)
        for seed in [[], {}, True, None]:
            with self.subTest(seed=seed), self.assertRaises(DataError):
                make_split(rows, seed)

    def test_same_post_and_full_corpus_transitive_lineage_grouped(self):
        # Bridge p1 joins p0 and p2 even if p1 has no imported annotation.
        self.quotes["headings"] = [
            {"id": "q0", "sourcePostIds": ["p0", "p1"], "variantGroupId": "v0", "leakageGroupId": "l0"},
            {"id": "q1", "sourcePostIds": ["p1", "p2"], "variantGroupId": "v1", "leakageGroupId": "l1"},
        ]
        self.log["posts"][0]["content"] += "\nTARGET_EXTRA_SENTINEL"
        self.log["sentences"].append({"id": "s0b", "postId": "p0", "text": "TARGET_EXTRA_SENTINEL"})
        self.write_sources()
        rows = self.fixture_rows(["s0", "s0b", "s2", "s3", "s4"])
        manifest = make_split(rows, "seed")
        assignments = manifest["assignments"]
        self.assertEqual(len({assignments[pid] for pid in ["human_s0", "human_s0b", "human_s2"]}), 1)

    def test_normalized_duplicate_source_posts_and_sentences_grouped(self):
        self.log["posts"][1]["content"] = "ＴＡＲＧＥＴ＿ＳＥＮＴＩＮＥＬ＿０００"
        self.log["sentences"][1]["text"] = "ＴＡＲＧＥＴ＿ＳＥＮＴＩＮＥＬ＿０００"
        self.write_sources()
        rows = self.fixture_rows()
        self.assertEqual(rows[0]["lineage"]["component_id"], rows[1]["lineage"]["component_id"])
        manifest = make_split(rows, "seed")
        self.assertEqual(manifest["assignments"]["human_s0"], manifest["assignments"]["human_s1"])

    def test_existing_near_duplicates_grouped(self):
        self.raw = [{"id": "raw-left", "text": self.log["posts"][0]["content"]},
                    {"id": "raw-right", "text": self.log["posts"][1]["content"]}]
        self.near = [{"left": "raw-left", "right": "raw-right"}]
        self.write_sources()
        rows = self.fixture_rows()
        manifest = make_split(rows, "seed")
        self.assertEqual(manifest["assignments"]["human_s0"], manifest["assignments"]["human_s1"])
        self.assertEqual(SourceCatalog(self.repo).mapped_near_duplicate_pairs, 1)
        self.raw[0]["text"] = "UNMAPPABLE"
        self.write_sources()
        with self.assertRaisesRegex(DataError, "UNMAPPED_NEAR_DUPLICATE"):
            SourceCatalog(self.repo)

    def test_ordinary_duplicates_cannot_cross_splits(self):
        rows = self.fixture_rows()
        rows[1]["ordinary_text"] = rows[0]["ordinary_text"].lower() + " \t"
        rows = validate_pairs(rows, self.repo)
        manifest = make_split(rows, "seed")
        self.assertEqual(manifest["assignments"]["human_s0"], manifest["assignments"]["human_s1"])
        tampered = copy.deepcopy(manifest)
        tampered["assignments"]["human_s1"] = "test" if tampered["assignments"]["human_s0"] != "test" else "train"
        with self.assertRaisesRegex(DataError, "CROSS_SPLIT_LEAKAGE"):
            validate_split(rows, tampered)

    def test_no_post_freeze_rewrite_or_lineage_changes(self):
        rows = self.fixture_rows()
        manifest = make_split(rows, "seed")
        for section, field, value in [(None, "ordinary_text", "CHANGED_SENTINEL"),
                                      ("review", "reviewer_id", "CHANGED_REVIEW"),
                                      ("lineage", "additional_family_ids", ["NEW_FAMILY"])]:
            changed = copy.deepcopy(rows)
            (changed[0] if section is None else changed[0][section])[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(DataError, "FROZEN_INPUT_HASH_MISMATCH"):
                validate_split(changed, manifest)

    def test_manifest_missing_extra_empty_or_reassigned_groups_rejected(self):
        rows = self.fixture_rows()
        manifest = make_split(rows, "seed")
        bad = copy.deepcopy(manifest)
        del bad["assignments"][rows[0]["pair_id"]]
        with self.assertRaises(DataError):
            validate_split(rows, bad)
        bad = copy.deepcopy(manifest)
        bad["assignments"]["EXTRA"] = "train"
        with self.assertRaises(DataError):
            validate_split(rows, bad)
        bad = copy.deepcopy(manifest)
        bad["counts"]["train"] += 1
        with self.assertRaises(DataError):
            validate_split(rows, bad)
        bad = copy.deepcopy(manifest)
        bad["components"][0]["pair_ids"].append("FAKE")
        with self.assertRaises(DataError):
            validate_split(rows, bad)

    def test_duplicate_pair_ids_rejected(self):
        rows = self.fixture_rows()
        with self.assertRaisesRegex(DataError, "DUPLICATE_PAIR_ID"):
            validate_pairs(rows + [rows[0]], self.repo)
        with self.assertRaisesRegex(DataError, "DUPLICATE_PAIR_ID"):
            make_split(rows + [rows[0]], "seed")

    def test_audit_counts_are_original_inventory_not_human_pairs(self):
        audit = audit_sources(self.repo)
        self.assertEqual(audit["verified_human_parallel_pairs"], 0)
        self.assertEqual(audit["archive_post_records"], 10)
        self.assertEqual(audit["archive_source_sentences"], 10)
        self.assertEqual(audit["full_corpus_leakage_components"], 10)
        self.assertEqual(audit["training_status"], "BLOCKED_HUMAN_PARALLEL_DATA_REQUIRED")

    def test_normalization_does_not_change_teacher_text(self):
        self.assertEqual(normalize_duplicate(" Ａ\n b\t"), "ab")
        rows = self.fixture_rows()
        rows[0]["ordinary_text"] = " Ａ \t B\n"
        validated = validate_pairs(rows, self.repo)
        self.assertEqual(validated[0]["ordinary_text"], " Ａ \t B\n")
        self.assertEqual(canonical_sha256({"a": 1, "b": 2}), canonical_sha256({"b": 2, "a": 1}))


if __name__ == "__main__":
    unittest.main()
