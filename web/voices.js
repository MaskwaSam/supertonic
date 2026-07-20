import {
    isAssetIntegrityError,
    loadTextToSpeech,
    loadVoiceStyle,
    writeWavFile
} from './helper.js';
import { normalizeForSpeech } from './speech-normalizer.js';
import {
    MAX_PREVIEW_CHARACTERS,
    MODEL_DOWNLOAD_MIB,
    assertTextWithinLimit,
    dataSaverEnabled,
} from './runtime-policy.js';

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
let generationToken = 0;
let bulkGenerationActive = false;
let modelSourceLabel = '';
let modelLoadPromise = null;
let lastProgressAnnouncementAt = 0;

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
const voiceStatusText = document.getElementById('voiceStatusText');
const voiceGrid = document.getElementById('voiceGrid');
const voiceProgress = document.getElementById('voiceProgress');

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
    voiceStatusText.textContent = message;
    statusBox.className = `status-box ${type}`;
}

function setProgress(value = 0, max = 1, label = '') {
    const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
    voiceProgress.max = safeMax;
    voiceProgress.value = Math.max(0, Math.min(Number(value) || 0, safeMax));
    voiceProgress.hidden = !label;
    statusBox.setAttribute('aria-busy', String(Boolean(label && voiceProgress.value < safeMax)));
    if (label) {
        voiceProgress.setAttribute('aria-label', label);
    } else {
        voiceProgress.removeAttribute('aria-label');
    }
}

function setThrottledProgressStatus(message, value, max, { force = false } = {}) {
    setProgress(value, max, message);
    const now = Date.now();
    if (force || now - lastProgressAnnouncementAt >= 750 || value >= max) {
        lastProgressAnnouncementAt = now;
        setStatus(message);
    }
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

function updateStopButton() {
    stopButton.disabled = !activeVoiceId && !bulkGenerationActive;
}

function setActiveVoice(voiceId) {
    activeVoiceId = voiceId;
    for (const [id, card] of cardByVoiceId.entries()) {
        card.element.classList.toggle('active', id === voiceId);
    }
    updateStopButton();
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
    return Number.isFinite(steps) ? Math.max(1, Math.min(50, steps)) : 8;
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

    if (modelLoadPromise) {
        await modelLoadPromise;
        return;
    }

    modelLoadPromise = loadModelFromConfiguredSources();
    try {
        await modelLoadPromise;
    } finally {
        modelLoadPromise = null;
    }
}

async function loadModelFromConfiguredSources() {
    const saveDataNote = dataSaverEnabled()
        ? ' Data Saver is on; this explicit action starts the download.'
        : '';
    setStatus(`Loading approximately ${MODEL_DOWNLOAD_MIB} MiB of model data.${saveDataNote}`);
    setProgress(0, 5, 'Loading Supertonic model data');

    let lastError = null;
    for (const baseUrl of modelSourceBaseUrls) {
        const label = sourceLabel(baseUrl);
        try {
            setStatus(`Loading Supertonic model from ${label}...`);
            const result = await loadWithBestProvider(assetUrl(baseUrl, 'onnx'), label);
            textToSpeech = result.textToSpeech;
            modelSourceLabel = label;
            setProgress(5, 5, 'Supertonic model ready');
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
    setProgress();
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
            (modelName, current, total) => setThrottledProgressStatus(
                `Loading ${label} model ${current}/${total}: ${modelName}`,
                current,
                total + 1,
                { force: true }
            )
        );
    } catch (webgpuError) {
        if (isAssetIntegrityError(webgpuError)) throw webgpuError;
        console.warn('WebGPU load failed for voice examples; falling back to WebAssembly.', webgpuError);
        return loadTextToSpeech(
            onnxBaseUrl,
            {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            },
            (modelName, current, total) => setThrottledProgressStatus(
                `Loading ${label} model ${current}/${total}: ${modelName}`,
                current,
                total + 1,
                { force: true }
            )
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

function generationAbortError() {
    const error = new Error('Generation stopped.');
    error.name = 'AbortError';
    return error;
}

function assertCurrentGeneration(token) {
    if (token !== generationToken) {
        throw generationAbortError();
    }
}

async function generateVoice(voice, token = generationToken) {
    const signature = currentSignature();
    const cached = audioCache.get(voice.id);
    if (cached?.signature === signature) {
        return cached;
    }

    const text = normalizeForSpeech(sampleText.value.trim()) || sampleText.value.trim();
    if (!text) {
        throw new Error('Enter preview text first.');
    }
    assertTextWithinLimit(text, MAX_PREVIEW_CHARACTERS, 'Preview text');

    try {
        await ensureModel();
    } catch (error) {
        assertCurrentGeneration(token);
        throw error;
    }
    assertCurrentGeneration(token);
    const style = await voiceStyle(voice);
    assertCurrentGeneration(token);
    const card = cardByVoiceId.get(voice.id);
    card.state.textContent = `Generating ${voice.label}...`;
    setStatus(`Generating ${voice.label} with ${getSteps()} steps...`);

    const result = await textToSpeech.synthesizeChunk(
        text,
        languageSelect.value,
        style,
        getSteps(),
        getSpeed(),
        (step, total) => {
            if (token === generationToken) {
                setThrottledProgressStatus(
                    `${voice.label}: denoising ${step}/${total}`,
                    step,
                    total,
                    { force: step === total }
                );
            }
        }
    );
    assertCurrentGeneration(token);
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
    generationToken += 1;
    bulkGenerationActive = false;
    stopActiveSource();
    updateStopButton();
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
    const token = ++generationToken;
    bulkGenerationActive = true;
    updateStopButton();
    try {
        sequenceToken += 1;
        await ensureAudioContext();
        assertCurrentGeneration(token);
        setBusy(true);
        const audio = await generateVoice(voice, token);
        assertCurrentGeneration(token);
        bulkGenerationActive = false;
        setBusy(false);
        setStatus(`Playing ${voice.label}.`);
        const completed = await playAudio(audio);
        if (completed && !activeVoiceId) {
            setStatus(`${voice.label} preview complete.`, 'success');
        }
    } catch (error) {
        setBusy(false);
        stopPlayback();
        if (error.name === 'AbortError') {
            setStatus('Stopped.');
        } else {
            setStatus(error.message, 'error');
        }
    } finally {
        if (token === generationToken) {
            bulkGenerationActive = false;
        }
        updateStopButton();
    }
}

async function generateAllVoices() {
    const token = ++generationToken;
    stopActiveSource();
    bulkGenerationActive = true;
    try {
        await ensureAudioContext();
        setBusy(true);
        updateStopButton();
        for (const voice of voices) {
            if (token !== generationToken) {
                break;
            }
            await generateVoice(voice, token);
            if (token !== generationToken) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (token === generationToken) {
            setStatus('All 10 voice previews are generated.', 'success');
        } else {
            setStatus('Stopped.');
        }
    } catch (error) {
        if (token === generationToken) {
            setStatus(error.message, 'error');
        }
    } finally {
        if (token === generationToken) {
            bulkGenerationActive = false;
        }
        setBusy(false);
        updateStopButton();
    }
}

async function playAllVoices() {
    const token = ++sequenceToken;
    const activeGenerationToken = ++generationToken;
    stopActiveSource();
    bulkGenerationActive = true;
    updateStopButton();
    try {
        await ensureAudioContext();
        setBusy(true);
        for (let index = 0; index < voices.length; index += 1) {
            const voice = voices[index];
            if (token !== sequenceToken || activeGenerationToken !== generationToken) {
                break;
            }
            setProgress(index, voices.length, `Preparing voice ${index + 1} of ${voices.length}`);
            const audio = await generateVoice(voice, activeGenerationToken);
            if (token !== sequenceToken || activeGenerationToken !== generationToken) {
                break;
            }
            setStatus(`Playing ${voice.label}.`);
            const completed = await playAudio(audio);
            if (!completed || token !== sequenceToken) {
                break;
            }
            await appendSilence();
        }
        if (token === sequenceToken && activeGenerationToken === generationToken) {
            setProgress(voices.length, voices.length, 'All voice previews complete');
            setStatus('Finished all 10 voice previews.', 'success');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            setStatus('Stopped.');
        } else {
            setStatus(error.message, 'error');
        }
    } finally {
        setBusy(false);
        if (token === sequenceToken && activeGenerationToken === generationToken) {
            setActiveVoice(null);
            bulkGenerationActive = false;
        }
        updateStopButton();
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
        return `<span class="voice-bar-height-${height}"></span>`;
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
    setProgress();
    setStatus('Stopped.');
});

window.addEventListener('beforeunload', stopPlayback);

renderVoices();
const saveDataMessage = dataSaverEnabled()
    ? ' Data Saver is on; the download starts only after a play or generate action.'
    : '';
setStatus(`Ready. The approximately ${MODEL_DOWNLOAD_MIB} MiB model loads on your first play or generate action.${saveDataMessage}`);
