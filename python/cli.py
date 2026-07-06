from __future__ import annotations

import argparse
import json
from pathlib import Path

from analyzer import analyze
from models import download_models, print_status, verify_remote_models


def analyze_command(args: argparse.Namespace) -> None:
    settings = json.loads(args.settings)
    result = analyze(Path(args.file), settings)
    print(result.to_json())


def models_command(args: argparse.Namespace) -> None:
    models_dir = Path(args.models_dir)
    if args.verify_remote:
        verify_remote_models()
    if args.download:
        download_models(models_dir)
    print_status(models_dir)


def main() -> None:
    parser = argparse.ArgumentParser(prog="filesift-sidecar")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze_parser = subparsers.add_parser("analyze")
    analyze_parser.add_argument("--file", required=True)
    analyze_parser.add_argument("--settings", required=True)
    analyze_parser.set_defaults(func=analyze_command)

    models_parser = subparsers.add_parser("models")
    models_parser.add_argument("--models-dir", required=True)
    models_parser.add_argument("--download", action="store_true")
    models_parser.add_argument("--verify-remote", action="store_true")
    models_parser.set_defaults(func=models_command)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
