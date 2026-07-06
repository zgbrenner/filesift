from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RequiredModel:
    key: str
    repo: str


REQUIRED_MODELS = [
    RequiredModel("gliclass", "knowledgator/gliclass-small-v1.0"),
    RequiredModel("qwen", "Qwen/Qwen2.5-0.5B-Instruct"),
]

READY_MARKER = ".filesift-model-ready"


def download_models(models_dir: Path) -> None:
    from huggingface_hub import snapshot_download  # type: ignore

    models_dir.mkdir(parents=True, exist_ok=True)
    for model in REQUIRED_MODELS:
        target = models_dir / model.key
        target.mkdir(parents=True, exist_ok=True)
        snapshot_download(
            repo_id=model.repo,
            local_dir=target,
            local_dir_use_symlinks=False,
            resume_download=True,
        )
        (target / READY_MARKER).write_text(model.repo, encoding="utf-8")


def print_status(models_dir: Path) -> None:
    for model in REQUIRED_MODELS:
        target = models_dir / model.key
        status = "ready" if (target / READY_MARKER).exists() else "missing"
        print(f"{model.key}\t{status}\t{target}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", required=True)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()

    models_dir = Path(args.models_dir)
    if args.download:
        download_models(models_dir)
    print_status(models_dir)


if __name__ == "__main__":
    main()
