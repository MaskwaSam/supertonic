#!/usr/bin/env python3
"""Snapshot and validate WAV outputs without third-party dependencies."""

import argparse
import json
import math
import struct
import wave
from pathlib import Path


def wav_files(root: Path):
    return sorted(path for path in root.rglob("*.wav") if path.is_file()) if root.exists() else []


def snapshot(root: Path, output: Path) -> None:
    state = {
        str(path.resolve()): {"size": path.stat().st_size, "mtime_ns": path.stat().st_mtime_ns}
        for path in wav_files(root)
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")


def has_non_silent_sample(raw: bytes, sample_width: int) -> bool:
    if sample_width == 1:
        return any(sample != 128 for sample in raw)
    if sample_width == 2:
        count = len(raw) // 2
        return any(sample != 0 for sample in struct.unpack(f"<{count}h", raw[: count * 2]))
    if sample_width == 3:
        for offset in range(0, len(raw) - 2, 3):
            value = int.from_bytes(raw[offset : offset + 3], "little", signed=True)
            if value != 0:
                return True
        return False
    if sample_width == 4:
        count = len(raw) // 4
        return any(sample != 0 for sample in struct.unpack(f"<{count}i", raw[: count * 4]))
    raise ValueError(f"unsupported PCM sample width: {sample_width}")


def validate_wav(path: Path) -> None:
    try:
        with wave.open(str(path), "rb") as wav:
            if wav.getcomptype() != "NONE":
                raise ValueError(f"compressed WAV ({wav.getcomptype()}) is unsupported")
            if wav.getnchannels() < 1 or wav.getframerate() < 1 or wav.getnframes() < 1:
                raise ValueError("invalid channel, sample-rate, or frame count")
            sample_width = wav.getsampwidth()
            frames = wav.readframes(wav.getnframes())
    except (wave.Error, EOFError) as exc:
        raise ValueError(f"invalid WAV container: {exc}") from exc
    if not frames:
        raise ValueError("WAV contains no audio data")
    if not has_non_silent_sample(frames, sample_width):
        raise ValueError("WAV is completely silent")


def validate(root: Path, baseline_path: Path) -> None:
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    changed = []
    for path in wav_files(root):
        resolved = str(path.resolve())
        stat = path.stat()
        old = baseline.get(resolved)
        if old is None or old["size"] != stat.st_size or old["mtime_ns"] != stat.st_mtime_ns:
            changed.append(path)
    if not changed:
        raise ValueError(f"no new or updated WAV files found in {root}")
    failures = []
    for path in changed:
        try:
            validate_wav(path)
        except ValueError as exc:
            failures.append(f"{path}: {exc}")
    if failures:
        raise ValueError("\n".join(failures))
    print(f"Validated {len(changed)} new or updated non-silent PCM WAV file(s)")


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    snapshot_parser = subparsers.add_parser("snapshot")
    snapshot_parser.add_argument("root", type=Path)
    snapshot_parser.add_argument("output", type=Path)
    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("root", type=Path)
    validate_parser.add_argument("baseline", type=Path)
    args = parser.parse_args()
    if args.command == "snapshot":
        snapshot(args.root, args.output)
    else:
        validate(args.root, args.baseline)


if __name__ == "__main__":
    try:
        main()
    except ValueError as exc:
        raise SystemExit(f"WAV validation failed: {exc}")
