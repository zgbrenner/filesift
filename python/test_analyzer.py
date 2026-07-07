from __future__ import annotations

import sys
import tempfile
import types
import unittest
from pathlib import Path

import analyzer


class GLiClassRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.previous_gliclass = sys.modules.get("gliclass")
        self.previous_transformers = sys.modules.get("transformers")

    def tearDown(self):
        if self.previous_gliclass is None:
            sys.modules.pop("gliclass", None)
        else:
            sys.modules["gliclass"] = self.previous_gliclass

        if self.previous_transformers is None:
            sys.modules.pop("transformers", None)
        else:
            sys.modules["transformers"] = self.previous_transformers

    def install_fakes(self, predictions):
        calls: dict[str, object] = {}

        class FakeModel:
            @classmethod
            def from_pretrained(cls, path, **kwargs):
                calls["model_path"] = path
                calls["model_kwargs"] = kwargs
                return cls()

        class FakeTokenizer:
            @classmethod
            def from_pretrained(cls, path, **kwargs):
                calls["tokenizer_path"] = path
                calls["tokenizer_kwargs"] = kwargs
                return cls()

        class FakePipeline:
            def __init__(self, model, tokenizer, **kwargs):
                calls["pipeline_model"] = model
                calls["pipeline_tokenizer"] = tokenizer
                calls["pipeline_kwargs"] = kwargs

            def __call__(self, text, labels, **kwargs):
                calls["text"] = text
                calls["labels"] = labels
                calls["call_kwargs"] = kwargs
                return [predictions]

        fake_gliclass = types.ModuleType("gliclass")
        fake_gliclass.GLiClassModel = FakeModel
        fake_gliclass.ZeroShotClassificationPipeline = FakePipeline

        fake_transformers = types.ModuleType("transformers")
        fake_transformers.AutoTokenizer = FakeTokenizer

        sys.modules["gliclass"] = fake_gliclass
        sys.modules["transformers"] = fake_transformers
        return calls

    def test_uses_official_single_label_pipeline_from_local_files(self):
        calls = self.install_fakes(
            [
                {"label": "Invoice", "score": 0.91},
                {"label": "NDA", "score": 0.08},
            ]
        )

        with tempfile.TemporaryDirectory() as directory:
            models_dir = Path(directory)
            model_dir = models_dir / "gliclass"
            model_dir.mkdir()
            (model_dir / ".filesift-model-ready").write_text("{}", encoding="utf-8")

            warnings: list[str] = []
            result = analyzer.classify_with_gliclass(
                "Invoice number 1001. Amount due within 30 days.",
                ["Invoice", "NDA", "Unknown"],
                models_dir,
                warnings,
            )

        self.assertIsNotNone(result)
        label, confidence, evidence = result
        self.assertEqual(label, "Invoice")
        self.assertAlmostEqual(confidence, 0.91)
        self.assertIn("GLiClass classified as Invoice", evidence[0])
        self.assertEqual(warnings, [])
        self.assertEqual(calls["model_kwargs"], {"local_files_only": True})
        self.assertEqual(calls["tokenizer_kwargs"], {"local_files_only": True})
        self.assertEqual(
            calls["pipeline_kwargs"],
            {
                "classification_type": "single-label",
                "device": "cpu",
                "progress_bar": False,
            },
        )
        self.assertEqual(calls["labels"], ["Invoice", "NDA"])
        self.assertEqual(calls["call_kwargs"], {"threshold": 0.0, "batch_size": 1})

    def test_rejects_a_prediction_outside_the_configured_labels(self):
        self.install_fakes([{"label": "Unapproved Label", "score": 0.99}])

        with tempfile.TemporaryDirectory() as directory:
            models_dir = Path(directory)
            model_dir = models_dir / "gliclass"
            model_dir.mkdir()
            (model_dir / ".filesift-model-ready").write_text("{}", encoding="utf-8")

            result = analyzer.classify_with_gliclass(
                "Some document text",
                ["Invoice", "NDA"],
                models_dir,
                [],
            )

        self.assertIsNone(result)

    def test_records_runtime_failures_and_allows_heuristic_fallback(self):
        class BrokenModel:
            @classmethod
            def from_pretrained(cls, path, **kwargs):
                raise RuntimeError("model could not load")

        fake_gliclass = types.ModuleType("gliclass")
        fake_gliclass.GLiClassModel = BrokenModel
        fake_gliclass.ZeroShotClassificationPipeline = object
        fake_transformers = types.ModuleType("transformers")
        fake_transformers.AutoTokenizer = object
        sys.modules["gliclass"] = fake_gliclass
        sys.modules["transformers"] = fake_transformers

        with tempfile.TemporaryDirectory() as directory:
            models_dir = Path(directory)
            model_dir = models_dir / "gliclass"
            model_dir.mkdir()
            (model_dir / ".filesift-model-ready").write_text("{}", encoding="utf-8")

            warnings: list[str] = []
            result = analyzer.classify_with_gliclass(
                "Invoice amount due",
                ["Invoice"],
                models_dir,
                warnings,
            )

        self.assertIsNone(result)
        self.assertEqual(warnings, ["GLiClass unavailable or failed: model could not load"])


if __name__ == "__main__":
    unittest.main()
