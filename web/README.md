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

- Node.js 20.19 or newer, or Node.js 22.12 or newer, for local development and builds.
- A modern browser with Web Audio support.
- HTTPS for production. The application shell can render over plain HTTP, but service workers and Web Crypto integrity enforcement require a secure context (localhost is treated as secure for development).
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

This pulls ONNX files and voice styles from the pinned release revision into `supertonic/assets`, which is served by the web app as `/assets` during development. Every download must match the recorded byte length and SHA-256 before it replaces a local asset.

## Run

```bash
npm ci
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
Before an ONNX model or model JSON is used, the browser checks its exact byte length and SHA-256 against the shipped `assets-integrity.json`. A missing manifest, unavailable Web Crypto, or any mismatch stops model loading.

Zip the contents of `web/dist`, upload the ZIP to an HTTPS static web server or Moodle File resource, unzip it, and open `index.html`. Open `voices.html` from the same folder to hear all 10 voice examples. The bundle uses relative paths, so it can be hosted at the web server root, inside a subfolder, or inside Moodle's file-serving path.

`npm run build:cdn` also writes `web/dist/README.txt`, which lists the bundled files and the pinned CDN model source. Do not test production bundles through `file://`.

## Static Bundle

Build a self-contained static folder:

```bash
npm run build:static
```

The output goes to `web/dist` and includes the app, ONNX Runtime Web files, Supertonic ONNX models, and all bundled Supertonic voice styles. This build loads models from the bundled `assets/` folder, so the uploaded app does not depend on Hugging Face after it is served over HTTPS.
The same folder also includes `voices.html` for side-by-side voice previews.

To create release archives from the current source:

```bash
npm run zip:cdn
npm run zip:static
```

Those commands rebuild, verify `web/dist`, and write `supertonic-reader-cdn.zip` or `supertonic-reader-static.zip` at the workspace root.

## Production Hosting

- Serve the extracted folder over HTTPS. Keep `assets-integrity.json`, `sw.js`, `app-shell-manifest.json`, both HTML files, `assets/`, and `onnx-runtime/` at their packaged relative paths.
- Send JavaScript (`.js` and `.mjs`) as JavaScript, `.wasm` as `application/wasm`, JSON as `application/json`, and ONNX files as `application/octet-stream`. Send `X-Content-Type-Options: nosniff`.
- Revalidate `index.html`, `voices.html`, `sw.js`, `app-shell-manifest.json`, and `assets-integrity.json` on deployment. Fingerprinted files under `assets/` may use long-lived immutable caching.
- The CDN bundle must be allowed to connect to `https://huggingface.co` and its signed asset hosts under `https://*.hf.co`. The static bundle needs only `'self'` connections.
- The service-worker build ID includes the build mode, asset base URL, pinned model revision, application sources, and lockfile. Replacing a CDN deployment with a static deployment at the same path therefore installs a distinct app-shell cache.

A strict baseline Content Security Policy for the CDN bundle is:

```text
default-src 'none'; base-uri 'none'; object-src 'none';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self';
connect-src 'self' https://huggingface.co https://*.hf.co;
worker-src 'self' blob:;
media-src 'self' blob:;
img-src 'self' data: blob:;
```

For the static bundle, reduce `connect-src` to `'self'`. `wasm-unsafe-eval` is required for ONNX Runtime WebAssembly compilation; JavaScript `unsafe-eval` and inline script/style permissions are not required by the packaged reader.

## Verification

The normal browser suite is deliberately model-free:

```bash
npm run test:ci
npm run test:e2e
```

Run the opt-in full-model smoke before a production promotion. It downloads the real model, generates a short utterance, and verifies the downloaded WAV header and payload:

```bash
npm run test:e2e:full-model
```

To exercise an already-hosted CDN or static release instead of the local Vite server:

```bash
SUPERTONIC_FULL_MODEL_URL=https://example.test/reader/ npm run test:e2e:full-model
```

## Usage

1. Choose a `.txt` file or edit the source text. No model data is downloaded in the background.
2. Pick a voice, language, step count, and speed.
3. Click `Load ~380 MiB & Play`; this explicit action downloads and verifies the model on first use. Later runs show `Generate & Play`.
4. Click any reader chunk once to generate or play from that chunk.
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
