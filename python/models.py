from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RequiredModel:
    key: str
    name: str
    repo: str
    revision: str
    license: str
    size: str


REQUIRED_MODELS = [
    RequiredModel(
        key="gliclass",
        name="GLiClass classifier",
        repo="knowledgator/gliclass-small-v1.0",
        revision="21edefaf7951f68c68c505f9139ba536d3b448f7",
        license="apache-2.0",
        size="about 1.24 GiB",
    ),
    RequiredModel(
        key="qwen",
        name="Qwen small language model",
        repo="Qwen/Qwen2.5-0.5B-Instruct",
        revision="7ae557604adf67be50417f59c2c2f167def9a775",
        license="apache-2.0",
        size="about 0.93 GiB",
    ),
]

READY_MARKER = ".filesift-model-ready"


def emit(event: str, **payload: object) -> None:
    print(json.dumps({"event": event, **payload}, ensure_ascii=True), flush=True)


def configure_hub_environment() -> None:
    # These must be set before importing huggingface_hub.
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    os.environ.setdefault("HF_HUB_VERBOSITY", "error")
    os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", "30")
    os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")


def marker_matches(target: Path, model: RequiredModel) -> bool:
    marker = target / READY_MARKER
    try:
        payload = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return payload.get("repo") == model.repo and payload.get("revision") == model.revision


def validate_download(target: Path, model: RequiredModel) -> None:
    config = target / "config.json"
    weights = [
        path
        for pattern in ("*.safetensors", "*.bin")
        for path in target.rglob(pattern)
        if path.is_file()
    ]
    if not config.is_file() or not weights:
        raise RuntimeError(
            f"{model.name} downloaded incompletely. "
            "FileSift could not find config.json and model weights."
        )


def write_ready_marker(target: Path, model: RequiredModel) -> None:
    marker = target / READY_MARKER
    temporary_marker = target / f"{READY_MARKER}.tmp"
    temporary_marker.write_text(
        json.dumps(
            {
                "repo": model.repo,
                "revision": model.revision,
                "license": model.license,
                "size": model.size,
            },
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )
    temporary_marker.replace(marker)


def download_models(models_dir: Path) -> None:
    configure_hub_environment()
    from huggingface_hub import snapshot_download  # type: ignore

    models_dir.mkdir(parents=True, exist_ok=True)
    for model in REQUIRED_MODELS:
        target = models_dir / model.key
        target.mkdir(parents=True, exist_ok=True)

        if marker_matches(target, model):
            emit(
                "model-complete",
                key=model.key,
                name=model.name,
                repo=model.repo,
                message=f"{model.name} is already downloaded.",
            )
            continue

        marker = target / READY_MARKER
        marker.unlink(missing_ok=True)
        emit(
            "model-start",
            key=model.key,
            name=model.name,
            repo=model.repo,
            message=f"Downloading {model.name} ({model.size})...",
        )

        snapshot_download(
            repo_id=model.repo,
            revision=model.revision,
            local_dir=target,
            max_workers=4,
        )
        validate_download(target, model)
        write_ready_marker(target, model)
        emit(
            "model-complete",
            key=model.key,
            name=model.name,
            repo=model.repo,
            message=f"{model.name} downloaded and verified.",
        )


def verify_remote_models() -> None:
    configure_hub_environment()
    from huggingface_hub import HfApi  # type: ignore

    api = HfApi()
    for model in REQUIRED_MODELS:
        emit("model-verify-start", key=model.key, name=model.name, repo=model.repo)
        api.model_info(model.repo, revision=model.revision)
        emit("model-verify-complete", key=model.key, name=model.name, repo=model.repo)


def print_status(models_dir: Path) -> None:
    for model in REQUIRED_MODELS:
        target = models_dir / model.key
        status = "ready" if marker_matches(target, model) else "missing"
        emit(
            "model-status",
            key=model.key,
            name=model.name,
            repo=model.repo,
            revision=model.revision,
            license=model.license,
            size=model.size,
            status=status,
            path=str(target),
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", required=True)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--verify-remote", action="store_true")
    args = parser.parse_args()

    models_dir = Path(args.models_dir)
    if args.verify_remote:
        verify_remote_models()
    if args.download:
        download_models(models_dir)
    print_status(models_dir)


if __name__ == "__main__":
    main()
