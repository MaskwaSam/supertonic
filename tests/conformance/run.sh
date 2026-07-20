#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ran=0

run_if_available() {
    local tool="$1"
    local name="$2"
    shift 2
    if command -v "$tool" >/dev/null 2>&1; then
        echo "==> $name"
        "$@"
        ran=$((ran + 1))
    else
        echo "==> $name (skipped: $tool not installed)"
    fi
}

run_if_available python3 Python env PYTHONDONTWRITEBYTECODE=1 python3 "$ROOT/py/test_conformance.py"
run_if_available node Node.js node "$ROOT/nodejs/test-conformance.js"
run_if_available node "Flutter language selector (static)" node "$ROOT/flutter/test/language_selector_static_test.mjs"
if command -v go >/dev/null 2>&1; then
    echo "==> Go"
    (cd "$ROOT/go" && GOCACHE="${TMPDIR:-/tmp}/supertonic-go-cache" go test ./textutil)
    ran=$((ran + 1))
else
    echo "==> Go (skipped: go not installed)"
fi
run_if_available rustc Rust rustc --edition=2021 --test "$ROOT/rust/src/conformance.rs" -o "${TMPDIR:-/tmp}/supertonic-rust-conformance"
if command -v rustc >/dev/null 2>&1; then
    "${TMPDIR:-/tmp}/supertonic-rust-conformance"
fi
run_if_available c++ C++ c++ -std=c++17 -Wall -Wextra -pedantic "$ROOT/cpp/text_utils.cpp" "$ROOT/cpp/test_text_utils.cpp" -o "${TMPDIR:-/tmp}/supertonic-cpp-conformance"
if command -v c++ >/dev/null 2>&1; then
    "${TMPDIR:-/tmp}/supertonic-cpp-conformance" "$ROOT/tests/conformance/conformance.json"
fi
run_if_available dart Dart dart "$ROOT/flutter/test/text_utils_test.dart"

if [ "$ran" -eq 0 ]; then
    echo "No supported toolchains were found." >&2
    exit 1
fi
