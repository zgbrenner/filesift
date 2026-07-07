from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

import models


class ModelDownloadTests(unittest.TestCase):
    def install_fake_hub(self, snapshot_download):
        fake_hub = types.ModuleType("huggingface_hub")
        fake_hub.snapshot_download = snapshot_download
        previous = sys.modules.get("huggingface_hub")
        sys.modules["huggingface_hub"] = fake_hub
        return previous

    def restore_hub(self, previous):
        if previous is None:
            sys.modules.pop("huggingface_hub", None)
        else:
            sys.modules["huggingface_hub"] = previous

    def test_download_uses_current_snapshot_api_and_writes_markers(self):
        calls = []

        def fake_snapshot_download(**kwargs):
            self.assertNotIn("resume_download", kwargs)
            self.assertNotIn("local_dir_use_symlinks", kwargs)
            target = Path(kwargs["local_dir"])
            target.mkdir(parents=True, exist_ok=True)
            (target / "config.json").write_text("{}", encoding="utf-8")
            (target / "model.safetensors").write_bytes(b"weights")
            calls.append(kwargs)
            return str(target)

        previous = self.install_fake_hub(fake_snapshot_download)
        try:
            with tempfile.TemporaryDirectory() as directory:
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    models.download_models(Path(directory))

                self.assertEqual(len(calls), len(models.REQUIRED_MODELS))
                for required_model in models.REQUIRED_MODELS:
                    marker = Path(directory) / required_model.key / models.READY_MARKER
                    self.assertTrue(marker.is_file())
                    payload = json.loads(marker.read_text(encoding="utf-8"))
                    self.assertEqual(payload["revision"], required_model.revision)

                calls.clear()
                with contextlib.redirect_stdout(io.StringIO()):
                    models.download_models(Path(directory))
                self.assertEqual(calls, [])

                events = [json.loads(line) for line in output.getvalue().splitlines()]
                self.assertEqual(
                    [event["event"] for event in events],
                    ["model-start", "model-complete", "model-start", "model-complete"],
                )
        finally:
            self.restore_hub(previous)

        self.assertEqual(os.environ["HF_HUB_DISABLE_PROGRESS_BARS"], "1")
        self.assertEqual(os.environ["HF_HUB_DISABLE_XET"], "1")

    def test_incomplete_download_never_gets_ready_marker(self):
        def fake_snapshot_download(**kwargs):
            target = Path(kwargs["local_dir"])
            target.mkdir(parents=True, exist_ok=True)
            (target / "config.json").write_text("{}", encoding="utf-8")
            return str(target)

        previous = self.install_fake_hub(fake_snapshot_download)
        try:
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(RuntimeError, "downloaded incompletely"):
                    with contextlib.redirect_stdout(io.StringIO()):
                        models.download_models(Path(directory))

                first = models.REQUIRED_MODELS[0]
                self.assertFalse((Path(directory) / first.key / models.READY_MARKER).exists())
        finally:
            self.restore_hub(previous)


if __name__ == "__main__":
    unittest.main()
