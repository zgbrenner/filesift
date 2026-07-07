from __future__ import annotations

import os
import sys


def _restore_windows_standard_streams() -> None:
    """Reconnect PyInstaller's windowed executable to pipes supplied by Tauri."""
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return

    import ctypes
    import msvcrt

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetStdHandle.argtypes = [ctypes.c_uint32]
    kernel32.GetStdHandle.restype = ctypes.c_void_p

    invalid_handle = ctypes.c_void_p(-1).value
    stream_specs = (
        ("stdout", -11),
        ("stderr", -12),
    )

    for attribute, handle_id in stream_specs:
        if getattr(sys, attribute) is not None:
            continue

        handle = kernel32.GetStdHandle(ctypes.c_uint32(handle_id & 0xFFFFFFFF))
        if handle in (None, 0, invalid_handle):
            setattr(sys, attribute, open(os.devnull, "w", encoding="utf-8"))
            continue

        try:
            file_descriptor = msvcrt.open_osfhandle(
                int(handle),
                os.O_WRONLY | getattr(os, "O_TEXT", 0),
            )
            stream = open(
                file_descriptor,
                "w",
                buffering=1,
                encoding="utf-8",
                errors="replace",
                closefd=False,
            )
        except (OSError, ValueError):
            stream = open(os.devnull, "w", encoding="utf-8")
        setattr(sys, attribute, stream)


_restore_windows_standard_streams()

import argparse
import json
import multiprocessing
from pathlib import Path


def analyze_command(args: argparse.Namespace) -> None:
    from analyzer import analyze

    settings = json.loads(args.settings)
    result = analyze(Path(args.file), settings)
    print(result.to_json(), flush=True)


def models_command(args: argparse.Namespace) -> None:
    from models import download_models, print_status, verify_remote_models

    models_dir = Path(args.models_dir)
    if args.verify_remote:
        verify_remote_models()
    if args.download:
        download_models(models_dir)
    print_status(models_dir)


def main() -> None:
    multiprocessing.freeze_support()

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
    try:
        args.func(args)
    except Exception as exc:
        if args.command == "models":
            print(
                json.dumps(
                    {
                        "event": "error",
                        "key": None,
                        "name": None,
                        "repo": None,
                        "message": f"{type(exc).__name__}: {exc}",
                    },
                    ensure_ascii=True,
                ),
                flush=True,
            )
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
