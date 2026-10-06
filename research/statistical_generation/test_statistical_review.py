"""Evaluation-integrity tests, with sentinel cases and no quality labels."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from research.statistical_generation.evaluation import evaluate, review_content_hash, summarize_reviews
from research.statistical_generation.pipeline import sha, write_json


class ComparisonIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.model = self.root / "model"
        self.model.mkdir()
        self.manifest = {"status": "human_parallel_research_unvalidated"}
        write_json(self.model / "manifest.json", self.manifest)
        self.rows = [{"pair_id": "test-only", "ordinary_text": "INPUT_SENTINEL", "lineage": {"component_id": "g0"}}]
        write_json(self.model / "pairs.json", self.rows)
        write_json(self.model / "splits.json", {"test": ["test-only"]})

    def run_comparison(self, new, old):
        def fake_baseline(command, log, **kwargs):
            write_json(Path(command[-1]), {"revision": "TEST_ONLY", "inputs": old})
        with patch("research.statistical_generation.evaluation.verify_model", return_value=(self.model, self.manifest, None, None)), \
             patch("research.statistical_generation.evaluation.decode_inputs", return_value={"inputs": new}), \
             patch("research.statistical_generation.evaluation.run", side_effect=fake_baseline):
            return evaluate(self.model, self.root, self.root / "comparison")

    def test_short_baseline_cannot_silently_truncate(self):
        with self.assertRaisesRegex(ValueError, "COMPARISON_INPUT_COUNT_MISMATCH"):
            self.run_comparison([{"source": "INPUT_SENTINEL", "candidates": []}], [])
        self.assertFalse((self.root / "comparison" / "summary.json").exists())

    def test_short_research_cannot_silently_truncate(self):
        with self.assertRaisesRegex(ValueError, "COMPARISON_INPUT_COUNT_MISMATCH"):
            self.run_comparison([], [{"source": "INPUT_SENTINEL", "candidate_pool": []}])

    def test_extra_case_is_rejected(self):
        row = {"source": "INPUT_SENTINEL", "candidates": []}
        with self.assertRaisesRegex(ValueError, "COMPARISON_INPUT_COUNT_MISMATCH"):
            self.run_comparison([row, row], [{"source": "INPUT_SENTINEL", "candidate_pool": []}])

    def test_matching_wrong_sources_cannot_replace_frozen_input(self):
        with self.assertRaisesRegex(ValueError, "COMPARISON_INPUT_MISMATCH"):
            self.run_comparison([{"source": "WRONG_SENTINEL", "candidates": []}],
                                [{"source": "WRONG_SENTINEL", "candidate_pool": []}])

    def test_unsupported_baseline_mode_cannot_be_a_comparison(self):
        with self.assertRaisesRegex(ValueError,"BASELINE_UNSUPPORTED_MODE"):
            self.run_comparison([{"source":"INPUT_SENTINEL","candidates":[]}],
                                [{"source":"INPUT_SENTINEL","candidate_pool":[],"fallback":{"text":"INPUT_SENTINEL","reason":"unsupported_generation_mode"}}])

    def test_valid_empty_pool_retains_denominator_without_quality_claim(self):
        result = self.run_comparison([{"source": "INPUT_SENTINEL", "candidates": []}],
                                     [{"source": "INPUT_SENTINEL", "candidate_pool": []}])
        self.assertEqual(result["input_count"], 1)
        self.assertEqual(len(result["metrics"]), 1)
        self.assertEqual(result["human_reviews"], 0)
        self.assertIsNone(result["quality_gain"])


class PartialReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.pack = {"purpose": "candidate_pool_human_review",
                     "annotation": {"author_type": "human", "annotator_id": "TEST_ONLY_FAKE_ID", "no_llm_or_synthetic": True},
                     "cases": [{"case_id": "test-only", "input": "INPUT_SENTINEL", "group": "g0",
                                "candidates": [{"candidate_id": "c0", "text": "OUTPUT_SENTINEL",
                                                "meaning_preserved": None, "buront_style_good": None,
                                                "readable": None, "reason": ""}]}]}
        self.pack["review_content_sha256"] = review_content_hash(self.pack)
        for name in ("baseline.json", "research.json"):
            write_json(self.root / name, {"fixture": True})
        write_json(self.root / "review.private.json", {
            "review_content_sha256": self.pack["review_content_sha256"],
            "candidate_origins": [{"case_id": "test-only", "candidate_id": "c0", "methods": ["research"], "eligible_research": True}],
            "baseline_sha256": sha(self.root / "baseline.json"),
            "research_sha256": sha(self.root / "research.json"),
        })

    def test_invalid_nonnull_label_is_rejected_even_when_incomplete(self):
        for invalid in ("yes", 0, 1, [], {}):
            self.pack["cases"][0]["candidates"][0]["meaning_preserved"] = invalid
            write_json(self.root / "review.json", self.pack)
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "INVALID_HUMAN_JUDGMENT"):
                summarize_reviews(self.root, self.root / "review.json")

    def test_incomplete_boolean_review_is_not_success(self):
        self.pack["cases"][0]["candidates"][0]["meaning_preserved"] = False
        write_json(self.root / "review.json", self.pack)
        result = summarize_reviews(self.root, self.root / "review.json")
        self.assertEqual(result["fully_reviewed_inputs"], 0)
        self.assertEqual(result["inputs_with_new_good_candidate"], 0)
        self.assertIsNone(result["rate"])


if __name__ == "__main__":
    unittest.main()
