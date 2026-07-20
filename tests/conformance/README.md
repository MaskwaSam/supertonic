# Model-free conformance contract

`conformance.json` is the shared contract for SDK text chunking and command-line
validation. Chunk limits are measured in Unicode scalar values, not UTF-8 bytes
or UTF-16 code units. Empty input produces no chunks. No returned chunk may
exceed `max_len`; an individual overlong token is split at Unicode-scalar
boundaries.

The command-line limits deliberately reject pathological inputs before any
model, voice style, or ONNX runtime is loaded:

- denoising steps: 1 through 100
- speed: finite, 0.25 through 4.0
- generation count: 1 through 100
- text: non-blank and at most 100,000 Unicode scalar values per item
- language: one of the 31 codes in the fixture

Run every model-free port available on the current machine with:

```sh
./tests/conformance/run.sh
```
