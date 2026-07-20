export const CDN_ASSET_REVISION = '724fb5abbf5502583fb520898d45929e62f02c0b';

export const REQUIRED_VOICE_STYLE_FILES = Object.freeze([
    'F1.json',
    'F2.json',
    'F3.json',
    'F4.json',
    'F5.json',
    'M1.json',
    'M2.json',
    'M3.json',
    'M4.json',
    'M5.json',
]);

export const REQUIRED_ONNX_FILES = Object.freeze([
    'tts.json',
    'unicode_indexer.json',
    'duration_predictor.onnx',
    'text_encoder.onnx',
    'vector_estimator.onnx',
    'vocoder.onnx',
]);

export const ONNX_RUNTIME_FILES = Object.freeze([
    { source: 'ort-wasm-simd-threaded.mjs', destination: 'ort-wasm-simd-threaded.mjs' },
    { source: 'ort-wasm-simd-threaded.mjs', destination: 'ort-wasm-simd-threaded.js' },
    { source: 'ort-wasm-simd-threaded.wasm', destination: 'ort-wasm-simd-threaded.wasm' },
    { source: 'ort-wasm-simd-threaded.jsep.mjs', destination: 'ort-wasm-simd-threaded.jsep.mjs' },
    { source: 'ort-wasm-simd-threaded.jsep.mjs', destination: 'ort-wasm-simd-threaded.jsep.js' },
    { source: 'ort-wasm-simd-threaded.jsep.wasm', destination: 'ort-wasm-simd-threaded.jsep.wasm' },
]);

export const LEGAL_FILES = Object.freeze([
    { source: '../LICENSE', destination: 'LICENSE.txt' },
    { source: 'legal/SUPERTONIC_MODEL_LICENSE.txt', destination: 'SUPERTONIC_MODEL_LICENSE.txt' },
    { source: 'legal/THIRD_PARTY_NOTICES.txt', destination: 'THIRD_PARTY_NOTICES.txt' },
]);
