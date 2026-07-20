#!/usr/bin/env python3
import json
import math
from pathlib import Path

from text_utils import CliInputs, chunk_text, validate_cli_inputs

FIXTURE = Path(__file__).parents[1] / "tests" / "conformance" / "conformance.json"


def main() -> None:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for case in data["chunking"]:
        actual = chunk_text(case["text"], case["max_len"])
        assert actual == case["expected"], (case["name"], actual, case["expected"])
        assert all(len(chunk) <= case["max_len"] for chunk in actual)

    baseline = {
        "total_step": 8,
        "speed": 1.05,
        "n_test": 1,
        "text": ["Hello."],
        "lang": ["en"],
    }
    for case in data["invalid_cli"]:
        values = dict(baseline)
        value = float("nan") if case["value"] == "NaN" else case["value"]
        values[case["field"]] = [value] if case["field"] in {"text", "lang"} else value
        try:
            validate_cli_inputs(CliInputs(**values))
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid CLI case accepted: {case['name']}")

    validate_cli_inputs(CliInputs(**baseline))
    print(f"Python conformance: {len(data['chunking'])} chunking and {len(data['invalid_cli'])} invalid CLI cases passed")


if __name__ == "__main__":
    main()
