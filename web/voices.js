import {
    loadTextToSpeech,
    loadVoiceStyle,
    writeWavFile
} from './helper.js';
import { normalizeForSpeech } from './speech-normalizer.js';

const DEFAULT_ASSET_BASE_URL = 'assets';
const SAMPLE_SILENCE_SECONDS = 0.35;

const voices = [
    { id: 'M1', label: 'Male 1', path: 'assets/voice_styles/M1.json', family: 'male' },
    { id: 'M2', label: 'Male 2', path: 'assets/voice_styles/M2.json', family: 'male' },
    { id: 'M3', label: 'Male 3', path: 'assets/voice_styles/M3.json', family: 'male' },
    { id: 'M4', label: 'Male 4', path: 'assets/voice_styles/M4.json', family: 'male' },
    { id: 'M5', label: 'Male 5', path: 'assets/voice_styles/M5.json', family: 'male' },
    { id: 'F1', label: 'Female 1', path: 'assets/voice_styles/F1.json', family: 'female' },
    { id: 'F2', label: 'Female 2', path: 'assets/voice_styles/F2.json', family: 'female' },
    { id: 'F3', label: 'Female 3', path: 'assets/voice_styles/F3.json', family: 'female' },
    { id: 'F4', label: 'Female 4', path: 'assets/voice_styles/F4.json', family: 'female' },
    { id: 'F5', label: 'Female 5', path: 'assets/voice_styles/F5.json', family: 'female' },
];

let textToSpeech = null;
let audioContext = null;
let activeSource = null;
let activeVoiceId = null;
let busy = false;
let sourceToken = 0;
let sequenceToken = 0;
let modelSourceLabel = '';

const styleCache = new Map();
const audioCache = new Map();
const cardByVoiceId = new Map();

const sampleText = document.getElementById('sampleText');
const languageSelect = document.getElementById('languageSelect');
const stepInput = document.getElementById('stepInput');
const speedInput = document.getElementById('speedInput');
const playAllButton = document.getElementById('playAllButton');
const generateAllButton = document.getElementById('generateAllButton');
const stopButton = document.getElementById('stopButton');
const statusBox = document.getElementById('statusBox');
const voiceGrid = document.getElementById('voiceGrid');

function normalizeAssetBaseUrls(value) {
    const urls = String(value || DEFAULT_ASSET_BASE_URL)
        .split(',')
        .map((baseUrl) => baseUrl.trim().replace(/\/$/, ''))
        .filter(Boolean);

    return urls.length ? urls : [DEFAULT_ASSET_BASE_URL];
}

const assetBaseUrls = normalizeAssetBaseUrls(
    import.meta.env.VITE_SUPERTONIC_ASSET_BASE_URLS ||
    import.meta.env.VITE_SUPERTONIC_ASSET_BASE_URL ||
    DEFAULT_ASSET_BASE_URL
);
const modelSourceBaseUrls = assetBaseUrls;

function assetUrl(baseUrl, relativePath) {
    return `${baseUrl}/${relativePath.replace(/^assets\//, '')}`;
}

function sourceLabel(baseUrl) {
    return /^https?:\/\//.test(baseUrl) ? 'CDN' : 'bundled assets';
}

function setStatus(message, type = 'info') {
    statusBox.textContent = message;
    statusBox.className = `status-box ${type}`;
}

function setBusy(nextBusy) {
    busy = nextBusy;
    playAllButton.disabled = busy;
    generateAllButton.disabled = busy;
    for (const card of cardByVoiceId.values()) {
        card.button.disabled = busy;
        card.download.disabled = busy || !audioCache.has(card.voice.id);
    }
}

function setActiveVoice(voiceId) {
    activeVoiceId = voiceId;
    for (const [id, card] of cardByVoiceId.entries()) {
        card.element.classList.toggle('active', id === voiceId);
    }
    stopButton.disabled = !voiceId;
}

function clearAudioCache() {
    stopPlayback();
    audioCache.clear();
    for (const card of cardByVoiceId.values()) {
        card.element.classList.remove('generated');
        card.state.textContent = 'Not generated yet.';
        card.download.disabled = true;
    }
}

function currentSignature() {
    return JSON.stringify({
        text: sampleText.value.trim(),
        lang: languageSelect.value,
        steps: stepInput.value,
        speed: speedInput.value
    });
}

function getSteps() {
    const steps = Number.parseInt(stepInput.value, 10);
    return Number.isFinite(steps) ? Math.max(1, Math.min(20, steps)) : 6;
}

function getSpeed() {
    const speed = Number.parseFloat(speedInput.value);
    return Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1.05;
}

async function ensureAudioContext() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
        throw new Error('This browser does not support Web Audio playback.');
    }
    if (!audioContext || audioContext.state === 'closed') {
        audioContext = new AudioContextCtor();
    }
    await audioContext.resume();
}

async function ensureModel() {
    if (textToSpeech) {
        return;
    }

    let lastError = null;
    for (const baseUrl of modelSourceBaseUrls) {
        const label = sourceLabel(baseUrl);
        try {
            setStatus(`Loading Supertonic model from ${label}...`);
            const result = await loadWithBestProvider(assetUrl(baseUrl, 'onnx'), label);
            textToSpeech = result.textToSpeech;
            modelSourceLabel = label;
            setStatus(`Model ready from ${label}.`, 'success');
            return;
        } catch (error) {
            lastError = error;
            console.warn(`Could not load voice example model from ${label}.`, error);
        }
    }

    const firstSource = modelSourceBaseUrls[0] || DEFAULT_ASSET_BASE_URL;
    const sourceHint = /^https?:\/\//.test(firstSource)
        ? 'Check that the browser can reach the configured Hugging Face model source.'
        : 'Serve this folder over HTTP or HTTPS and keep the assets/onnx folder next to voices.html.';
    throw new Error(`Could not load Supertonic model assets. ${sourceHint} ${lastError?.message || ''}`.trim());
}

async function loadWithBestProvider(onnxBaseUrl, label) {
    try {
        return await loadTextToSpeech(
            onnxBaseUrl,
            {
                executionProviders: ['webgpu'],
                graphOptimizationLevel: 'all'
            },
            (modelName, current, total) => setStatus(`Loading ${label} model ${current}/${total}: ${modelName}`)
        );
    } catch (webgpuError) {
        console.warn('WebGPU load failed for voice examples; falling back to WebAssembly.', webgpuError);
        return loadTextToSpeech(
            onnxBaseUrl,
            {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            },
            (modelName, current, total) => setStatus(`Loading ${label} model ${current}/${total}: ${modelName}`)
        );
    }
}

async function voiceStyle(voice) {
    if (!styleCache.has(voice.id)) {
        setStatus(`Loading ${voice.label} style...`);
        styleCache.set(voice.id, await loadVoiceStyle([voice.path], true));
    }
    return styleCache.get(voice.id);
}

async function generateVoice(voice) {
    const signature = currentSignature();
    const cached = audioCache.get(voice.id);
    if (cached?.signature === signature) {
        return cached;
    }

    const text = normalizeForSpeech(sampleText.value.trim()) || sampleText.value.trim();
    if (!text) {
        throw new Error('Enter preview text first.');
    }

    await ensureModel();
    const style = await voiceStyle(voice);
    const card = cardByVoiceId.get(voice.id);
    card.state.textContent = `Generating ${voice.label}...`;
    setStatus(`Generating ${voice.label} with ${getSteps()} steps...`);

    const result = await textToSpeech.synthesizeChunk(
        text,
        languageSelect.value,
        style,
        getSteps(),
        getSpeed(),
        (step, total) => setStatus(`${voice.label}: denoising ${step}/${total}`)
    );
    const buffer = audioContext.createBuffer(1, result.wav.length, textToSpeech.sampleRate);
    buffer.copyToChannel(result.wav, 0);
    const audio = {
        signature,
        voice,
        wav: result.wav,
        sampleRate: textToSpeech.sampleRate,
        buffer
    };
    audioCache.set(voice.id, audio);
    card.element.classList.add('generated');
    card.state.textContent = `Generated from ${modelSourceLabel || 'model source'}.`;
    card.download.disabled = busy;
    return audio;
}

function stopActiveSource() {
    sourceToken += 1;
    if (activeSource) {
        try {
            activeSource.stop();
        } catch {
            // The source may already have ended.
        }
        activeSource = null;
    }
    setActiveVoice(null);
}

function stopPlayback() {
    sequenceToken += 1;
    stopActiveSource();
}

function playAudio(audio) {
    stopActiveSource();
    const token = ++sourceToken;
    return new Promise((resolve) => {
        const source = audioContext.createBufferSource();
        source.buffer = audio.buffer;
        source.connect(audioContext.destination);
        source.onended = () => {
            if (token === sourceToken) {
                activeSource = null;
                setActiveVoice(null);
            }
            resolve(token === sourceToken);
        };
        activeSource = source;
        setActiveVoice(audio.voice.id);
        source.start();
    });
}

async function playVoice(voice) {
    try {
        sequenceToken += 1;
        await ensureAudioContext();
        setBusy(true);
        const audio = await generateVoice(voice);
        setBusy(false);
        setStatus(`Playing ${voice.label}.`);
        const completed = await playAudio(audio);
        if (completed && !activeVoiceId) {
            setStatus(`${voice.label} preview complete.`, 'success');
        }
    } catch (error) {
        setBusy(false);
        stopPlayback();
        setStatus(error.message, 'error');
    }
}

async function generateAllVoices() {
    try {
        await ensureAudioContext();
        setBusy(true);
        for (const voice of voices) {
            await generateVoice(voice);
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        setStatus('All 10 voice previews are generated.', 'success');
    } catch (error) {
        setStatus(error.message, 'error');
    } finally {
        setBusy(false);
    }
}

async function playAllVoices() {
    const token = ++sequenceToken;
    stopActiveSource();
    try {
        await ensureAudioContext();
        setBusy(true);
        for (const voice of voices) {
            if (token !== sequenceToken) {
                break;
            }
            const audio = await generateVoice(voice);
            if (token !== sequenceToken) {
                break;
            }
            setStatus(`Playing ${voice.label}.`);
            const completed = await playAudio(audio);
            if (!completed || token !== sequenceToken) {
                break;
            }
            await appendSilence();
        }
        if (token === sequenceToken) {
            setStatus('Finished all 10 voice previews.', 'success');
        }
    } catch (error) {
        setStatus(error.message, 'error');
    } finally {
        setBusy(false);
        if (token === sequenceToken) {
            setActiveVoice(null);
        }
    }
}

function appendSilence() {
    return new Promise((resolve) => setTimeout(resolve, SAMPLE_SILENCE_SECONDS * 1000));
}

function downloadVoice(voice) {
    const audio = audioCache.get(voice.id);
    if (!audio) {
        return;
    }
    const wav = writeWavFile(audio.wav, audio.sampleRate);
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `supertonic-${voice.id.toLowerCase()}-preview.wav`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function waveBars(voice) {
    const seed = voice.id.charCodeAt(0) + Number(voice.id.slice(1)) * 7;
    return Array.from({ length: 18 }, (_, index) => {
        const height = 18 + ((seed + index * 11) % 30);
        return `<span style="height:${height}px"></span>`;
    }).join('');
}

function renderVoices() {
    const fragment = document.createDocumentFragment();
    for (const voice of voices) {
        const card = document.createElement('article');
        card.className = `voice-card ${voice.family}`;
        card.innerHTML = `
            <div class="voice-title">
                <h2>${voice.label}</h2>
                <span class="voice-pill">${voice.id}</span>
            </div>
            <div class="voice-wave" aria-hidden="true">${waveBars(voice)}</div>
            <p class="voice-state">Not generated yet.</p>
            <div class="voice-actions">
                <button class="primary-action" type="button">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="8 5 19 12 8 19 8 5"></polygon></svg>
                    Play ${voice.id}
                </button>
                <button type="button" disabled>Download WAV</button>
            </div>
        `;
        const buttons = card.querySelectorAll('button');
        const button = buttons[0];
        const download = buttons[1];
        const state = card.querySelector('.voice-state');
        button.addEventListener('click', () => playVoice(voice));
        download.addEventListener('click', () => downloadVoice(voice));
        cardByVoiceId.set(voice.id, { voice, element: card, button, download, state });
        fragment.appendChild(card);
    }
    voiceGrid.replaceChildren(fragment);
}

for (const element of [sampleText, languageSelect, stepInput, speedInput]) {
    element.addEventListener('input', clearAudioCache);
    element.addEventListener('change', clearAudioCache);
}

playAllButton.addEventListener('click', playAllVoices);
generateAllButton.addEventListener('click', generateAllVoices);
stopButton.addEventListener('click', () => {
    stopPlayback();
    setStatus('Stopped.');
});

window.addEventListener('beforeunload', stopPlayback);

renderVoices();
