# Supertonic Reader

Browser text-to-speech reader for `.txt` files. It runs Supertonic 3 with ONNX Runtime Web, starts playback after the first generated chunk, and highlights the currently playing reader chunk.

## Features

- Load a `.txt` file or paste text directly.
- Generate audio with Supertonic 3 using WebGPU when available and WebAssembly fallback.
- Stream playback chunk-by-chunk instead of waiting for the full file.
- Follow along with chunk-level reader highlighting.
- Optionally highlight the current word while a chunk plays.
- Double-click a reader chunk to start there; generated chunks reuse cached audio.
- Pause, resume, stop, and download the completed WAV after generation finishes.
- Choose all bundled Supertonic voices: F1-F5 and M1-M5.
- Open `voices.html` to compare all 10 bundled voices with the same sample text.
- Choose language, denoising steps, and speed.
- Load a Supertonic-compatible custom voice style JSON as a temporary voice option.
- Cache the app shell for faster repeat visits.

## Requirements

- Node.js for local development and builds.
- A modern browser with Web Audio support.
- Supertonic assets available at:
  - `assets/onnx/tts.json`
  - `assets/onnx/unicode_indexer.json`
  - `assets/onnx/duration_predictor.onnx`
  - `assets/onnx/text_encoder.onnx`
  - `assets/onnx/vector_estimator.onnx`
  - `assets/onnx/vocoder.onnx`
  - `assets/voice_styles/*.json`

The `web/assets` path points to `../assets`, so place shared assets in `supertonic/assets`.

## Setup Assets

Download the Supertonic 3 model assets from Hugging Face:

```bash
npm run assets:download
```

This pulls ONNX files and voice styles from `https://huggingface.co/Supertone/supertonic-3` into `supertonic/assets`, which is served by the web app as `/assets` during development.

## Run

```bash
npm install
npm run assets:download
npm run dev
```

Vite serves the app at `http://localhost:3000` by default.

## CDN ZIP

Build the small CDN static folder:

```bash
npm run build:cdn
```

The output goes to `web/dist` and includes the app, ONNX Runtime Web files, and all 10 Supertonic voice-style JSON files. It does not include Supertonic ONNX model files or any secondary TTS model. Supertonic model files load from the pinned Hugging Face revision `724fb5abbf5502583fb520898d45929e62f02c0b`.
The CDN build does not silently fall back to local model files; if the configured CDN cannot be reached, the app reports the CDN failure.

Zip the contents of `web/dist`, upload the ZIP to a static web server or Moodle File resource, unzip it, and open `index.html` over HTTP or HTTPS. Open `voices.html` from the same folder to hear all 10 voice examples. The bundle uses relative paths, so it can be hosted at the web server root, inside a subfolder, or inside Moodle's file-serving path.

`npm run build:cdn` also writes `web/dist/README.txt`, which lists the bundled files and the pinned CDN model source. Serve `.mjs` files as JavaScript and `.wasm` files as WebAssembly; do not test production bundles through `file://`.

## Static Bundle

Build a self-contained static folder:

```bash
npm run build:static
```

The output goes to `web/dist` and includes the app, ONNX Runtime Web files, Supertonic ONNX models, and all bundled Supertonic voice styles. This build loads models from the bundled `assets/` folder, so the uploaded app does not depend on Hugging Face after it is served over HTTP or HTTPS.
The same folder also includes `voices.html` for side-by-side voice previews.

To create release archives from the current source:

```bash
npm run zip:cdn
npm run zip:static
```

Those commands rebuild, verify `web/dist`, and write `supertonic-reader-cdn.zip` or `supertonic-reader-static.zip` at the workspace root.

## Usage

1. Wait for the status bar to show that Supertonic is loaded.
2. Choose a `.txt` file or edit the source text.
3. Pick a voice, language, step count, and speed.
4. Click `Generate & Play`.
5. Use the reader panel to follow the active generated chunk.
6. Download the final WAV after all chunks are generated.

## Custom Voice

The reader cannot turn raw microphone audio into a voice style by itself. To use your own voice, create and download a Supertonic-compatible voice-style JSON from Supertonic Voice Builder, then open the top-right voice settings gear and load that JSON with the `Custom voice JSON` picker.

For a permanently bundled option, place the downloaded JSON in `assets/voice_styles/` and add a matching `<option>` in `web/index.html`.

## Notes

- Streaming means chunks are played as soon as they are generated. If generation is slower than playback, the player waits for the next chunk and resumes automatically.
- Reader sync is chunk-level by default. The optional word highlighting estimates timing inside each chunk because Supertonic does not provide word timestamps in this browser path.
- Very long files still require enough browser memory to keep generated chunks for the final WAV download.
- The default step count is 8.
- The service worker precaches the production app shell from `app-shell-manifest.json`. It does not cache Supertonic model files, voice styles, or runtime WASM files by default.
- On mobile, keep the page open and the screen awake while generating.
