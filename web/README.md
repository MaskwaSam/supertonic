# Supertonic Reader

Browser-local text-to-speech reader for `.txt` files. It runs Supertonic 3 with ONNX Runtime Web on the device, starts playback after the first generated text chunk, and highlights the currently playing chunk in the reader.

## Features

- Load a `.txt` file or paste text directly.
- Generate audio locally in the browser with WebGPU when available and WebAssembly fallback.
- Stream playback chunk-by-chunk instead of waiting for the full file.
- Follow along with chunk-level reader highlighting.
- Pause, resume, stop, and download the completed WAV after generation finishes.
- Choose voice style, language, denoising steps, and speed.

## Requirements

- Node.js for the Vite development server.
- A modern browser with Web Audio support.
- Supertonic assets available at:
  - `assets/onnx/tts.json`
  - `assets/onnx/unicode_indexer.json`
  - `assets/onnx/duration_predictor.onnx`
  - `assets/onnx/text_encoder.onnx`
  - `assets/onnx/vector_estimator.onnx`
  - `assets/onnx/vocoder.onnx`
  - `assets/voice_styles/*.json`

The `web/assets` path points to `../assets`, so place the shared assets in `supertonic/assets`.

## Setup Assets

Download the Supertonic 3 model assets from Hugging Face:

```bash
npm run assets:download
```

This pulls ONNX files and voice styles from `https://huggingface.co/Supertone/supertonic-3` into `supertonic/assets`, which is served by the web app as `/assets`.

## Run

```bash
npm install
npm run assets:download
npm run dev
```

Vite serves the app at `http://localhost:3000` by default.

## Static ZIP

Build a self-contained static folder:

```bash
npm run build:static
```

The output goes to `web/dist` and includes the app, ONNX runtime files, Supertonic ONNX models, and voice styles. This build tries Hugging Face first, then falls back to the bundled model files if the CDN cannot be reached. Zip the contents of `web/dist`, upload the ZIP to a web server, unzip it, and open `index.html` over HTTP or HTTPS.

The static bundle uses relative paths, so it can be hosted at the web server root or inside a subfolder.

## CDN ZIP

Build a smaller static folder that loads Supertonic model assets from Hugging Face:

```bash
npm run build:cdn
```

The output goes to `web/dist` and includes the app plus ONNX Runtime Web files. It does not include the Supertonic ONNX models or voice styles; those load from `https://huggingface.co/Supertone/supertonic-3/resolve/main`.

## Usage

1. Wait for the status bar to show that models are loaded.
2. Choose a `.txt` file or edit the source text.
3. Select voice, language, steps, and speed.
4. Click `Generate & Play`.
5. Use the reader panel to follow the active generated chunk.
6. Download the final WAV after all chunks are generated.

## Notes

- Streaming means chunks are played as soon as they are generated. If generation is slower than playback, the player waits for the next chunk and resumes automatically.
- Reader sync is chunk-level. Supertonic does not provide word timestamps in this browser path.
- Very long files still require enough browser memory to keep generated chunks for the final WAV download.
