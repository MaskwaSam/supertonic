import {
    chunkText,
    getWebFetchDiagnostics,
    isAssetIntegrityError,
    loadTextToSpeech,
    loadVoiceStyle,
    writeWavFile
} from './helper.js';
import { normalizeForSpeech } from './speech-normalizer.js';
import {
    MAX_CUSTOM_VOICE_FILE_BYTES,
    MAX_READER_CHARACTERS,
    MAX_TEXT_FILE_BYTES,
    MODEL_DOWNLOAD_MIB,
    assertFileWithinLimit,
    assertTextWithinLimit,
    dataSaverEnabled,
    validateVoiceStyleObject,
} from './runtime-policy.js';

const DEFAULT_ASSET_BASE_URL = 'assets';
function normalizeAssetBaseUrls(value) {
    const urls = String(value || DEFAULT_ASSET_BASE_URL)
        .split(',')
        .map((baseUrl) => baseUrl.trim().replace(/\/$/, ''))
        .filter(Boolean);

    for (const url of urls) {
        if (/^https?:\/\//.test(url)) {
            new URL(url);
        } else if (!/^[./A-Za-z0-9_-][./A-Za-z0-9_-]*$/.test(url)) {
            throw new Error(`Invalid Supertonic asset base URL: ${url}`);
        }
    }

    return urls.length ? urls : [DEFAULT_ASSET_BASE_URL];
}

const ASSET_BASE_URLS = normalizeAssetBaseUrls(
    import.meta.env.VITE_SUPERTONIC_ASSET_BASE_URLS ||
    import.meta.env.VITE_SUPERTONIC_ASSET_BASE_URL ||
    DEFAULT_ASSET_BASE_URL
);
const MODEL_SOURCE_BASE_URLS = ASSET_BASE_URLS;
const VOICE_STYLE_BASE_URL = (import.meta.env.VITE_SUPERTONIC_VOICE_STYLE_BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
const DEFAULT_VOICE_STYLE_PATH = 'assets/voice_styles/M1.json';
const CHUNK_SILENCE_SECONDS = 0.3;
const START_LEAD_SECONDS = 0.08;
const TTS_ENGINE_SUPERTONIC = 'supertonic';
const TOTAL_STEP_MIN = 1;
const TOTAL_STEP_MAX = 50;
const TOTAL_STEP_DEFAULT = 8;
const SPEED_MIN = 0.5;
const SPEED_MAX = 2;
const SPEED_DEFAULT = 1.05;

let textToSpeech = null;
let currentStyle = null;
let currentStylePath = DEFAULT_VOICE_STYLE_PATH;
let activeAssetBaseUrl = ASSET_BASE_URLS[0] || DEFAULT_ASSET_BASE_URL;
let modelsReady = false;
let modelLoading = false;
let modelLoadId = 0;
let modelLoadPromise = null;
let styleLoadId = 0;
let styleLoading = false;
let supertonicBackendText = 'WebAssembly';
let supertonicBackendUsesWebGPU = false;
let webGpuAvailabilityPromise = null;

let runId = 0;
let runActive = false;
let generationActive = false;
let generationComplete = false;
let playbackComplete = false;
let isPaused = false;

let audioContext = null;
let firstStartTime = null;
let nextStartTime = 0;
let animationFrameId = null;

let chunks = [];
let chunkElements = [];
let generatedChunks = [];
let scheduledChunks = [];
let activeSources = [];
let generatedCount = 0;
let generatedAudioSeconds = 0;
let activeChunkIndex = -1;
let playbackEndIndex = -1;
let downloadUrl = null;
let downloadEngine = null;
let customVoiceObjectUrl = null;
let customVoiceOption = null;
let wordHighlightEnabled = false;
let chunkWordElements = [];
let activeWordElement = null;
let lastProgressAnnouncementAt = 0;

const fileInput = document.getElementById('fileInput');
const textInput = document.getElementById('text');
const voiceStyleSelect = document.getElementById('voiceStyleSelect');
const voiceSettingsContainer = document.getElementById('voiceSettingsContainer');
const voiceSettingsButton = document.getElementById('voiceSettingsButton');
const voiceSettingsPanel = document.getElementById('voiceSettingsPanel');
const wordHighlightToggle = document.getElementById('wordHighlightToggle');
const supertonicSettings = Array.from(document.querySelectorAll('.supertonic-setting'));
const customVoiceInput = document.getElementById('customVoiceInput');
const langSelect = document.getElementById('langSelect');
const totalStepInput = document.getElementById('totalStep');
const speedInput = document.getElementById('speed');
const generatePlayBtn = document.getElementById('generatePlayBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const stopBtn = document.getElementById('stopBtn');
const stickyPlayBtn = document.getElementById('stickyPlayBtn');
const stickyPauseBtn = document.getElementById('stickyPauseBtn');
const stickyStopBtn = document.getElementById('stickyStopBtn');
const stickyDownloadBtn = document.getElementById('stickyDownloadBtn');
const stickyControls = document.querySelector('.sticky-controls');
const downloadBtn = document.getElementById('downloadBtn');
const statusBox = document.getElementById('statusBox');
const statusPhase = document.getElementById('statusPhase');
const statusText = document.getElementById('statusText');
const backendBadge = document.getElementById('backendBadge');
const modelSourceBadge = document.getElementById('modelSourceBadge');
const errorBox = document.getElementById('error');
const reader = document.getElementById('reader');
const chunkStat = document.getElementById('chunkStat');
const generatedStat = document.getElementById('generatedStat');
const elapsedStat = document.getElementById('elapsedStat');
const durationStat = document.getElementById('durationStat');
const runProgress = document.getElementById('runProgress');

function assetUrl(path, baseUrl = activeAssetBaseUrl) {
    return `${baseUrl}/${path.replace(/^assets\//, '')}`;
}

function resolveAssetPath(path, baseUrl = activeAssetBaseUrl) {
    if (/^(https?:|blob:|data:)/.test(path)) {
        return path;
    }

    return assetUrl(path, baseUrl);
}

function resolveVoiceStylePath(path) {
    if (/^(https?:|blob:|data:)/.test(path)) {
        return path;
    }

    if (path.startsWith('assets/voice_styles/')) {
        const voiceRelativePath = path.replace(/^assets\//, '');
        return VOICE_STYLE_BASE_URL
            ? `${VOICE_STYLE_BASE_URL}/${voiceRelativePath}`
            : path;
    }

    return resolveAssetPath(path);
}

function assetSourceLabel(baseUrl) {
    return /^https?:\/\//.test(baseUrl) ? 'CDN' : 'local assets';
}

function hasUsableWebGpu() {
    if (!webGpuAvailabilityPromise) {
        webGpuAvailabilityPromise = (async () => {
            if (!globalThis.navigator?.gpu?.requestAdapter) {
                return false;
            }
            try {
                return Boolean(await globalThis.navigator.gpu.requestAdapter());
            } catch {
                return false;
            }
        })();
    }
    return webGpuAvailabilityPromise;
}

function isBundledAssetSource(baseUrl = activeAssetBaseUrl) {
    return !/^https?:\/\//.test(baseUrl);
}

function getMaxChunkLength(lang) {
    return (lang === 'ko' || lang === 'ja') ? 120 : 300;
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '0:00';
    }

    const rounded = Math.floor(seconds);
    const minutes = Math.floor(rounded / 60);
    const remainingSeconds = String(rounded % 60).padStart(2, '0');
    return `${minutes}:${remainingSeconds}`;
}

function clampNumber(value, min, max, fallback) {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, value));
}

function normalizedSynthesisSettings() {
    const totalStep = clampNumber(
        Number.parseInt(totalStepInput.value, 10),
        TOTAL_STEP_MIN,
        TOTAL_STEP_MAX,
        TOTAL_STEP_DEFAULT
    );
    const speed = clampNumber(
        Number.parseFloat(speedInput.value),
        SPEED_MIN,
        SPEED_MAX,
        SPEED_DEFAULT
    );

    totalStepInput.value = String(totalStep);
    speedInput.value = String(speed);

    return { totalStep, speed };
}

function setStatus(message, type = 'info', phase = null) {
    if (phase) {
        statusPhase.textContent = phase;
    }
    statusText.textContent = message;
    statusBox.className = `status-box ${type}`;
}

function setProgress(value = 0, max = 1, label = '') {
    const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
    const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(value, safeMax)) : 0;
    runProgress.max = safeMax;
    runProgress.value = safeValue;
    runProgress.hidden = !label;
    statusBox.setAttribute('aria-busy', String(Boolean(label && safeValue < safeMax)));
    if (label) {
        runProgress.setAttribute('aria-label', label);
    } else {
        runProgress.removeAttribute('aria-label');
    }
}

function setThrottledProgressStatus(message, phase, value, max, { force = false } = {}) {
    setProgress(value, max, message);
    const now = Date.now();
    if (force || now - lastProgressAnnouncementAt >= 750 || value >= max) {
        lastProgressAnnouncementAt = now;
        setStatus(message, 'info', phase);
    }
}

function setModelSource(baseUrl, state = 'ready') {
    const bundled = isBundledAssetSource(baseUrl);
    const sourceName = bundled ? 'Bundled' : 'CDN';

    const stateSuffix = {
        loading: '...',
        error: ' unavailable',
        ready: ''
    }[state] || '';

    modelSourceBadge.textContent = `Model: Supertonic ${sourceName}${stateSuffix}`;
    modelSourceBadge.className = 'source-badge visible';
    modelSourceBadge.classList.add(bundled ? 'bundled' : 'cdn');
    modelSourceBadge.classList.toggle('error', state === 'error');
}

function setBackendBadge(text, { webgpu = false } = {}) {
    backendBadge.textContent = text;
    backendBadge.classList.toggle('webgpu', webgpu);
    backendBadge.classList.add('visible');
}

function getActiveEngine() {
    return TTS_ENGINE_SUPERTONIC;
}

function isActiveSynthesizerReady() {
    return modelsReady && textToSpeech && currentStyle;
}

function refreshActiveModelBadges() {
    if (modelsReady || modelLoading) {
        setBackendBadge(supertonicBackendText, { webgpu: supertonicBackendUsesWebGPU });
        setModelSource(activeAssetBaseUrl, modelLoading ? 'loading' : 'ready');
    }
}

function updateVisibleModelSettings() {
    for (const element of supertonicSettings) {
        element.hidden = false;
    }
}

function getDownloadEngine() {
    return TTS_ENGINE_SUPERTONIC;
}

function getDownloadFileName() {
    return 'supertonic-reader.wav';
}

function updateDownloadButtonLabel() {
    downloadBtn.textContent = 'Download WAV';
}

function showError(message) {
    if (message && typeof message === 'object' && message.fetchDiagnostics) {
        console.warn('Supertonic fetch diagnostics:', message.fetchDiagnostics);
    }

    const normalized = message instanceof Error
        ? message.message
        : String(message ?? '');

    errorBox.textContent = normalized;
    errorBox.classList.add('active');
}

function formatFetchDiagnostics(error) {
    const diagnostics = error?.fetchDiagnostics;
    if (!diagnostics) {
        return '';
    }

    if (Array.isArray(diagnostics.attempts)) {
        return diagnostics.attempts
            .map((attempt) => {
                if (typeof attempt === 'string') {
                    return attempt;
                }
                if (attempt?.diagnostic) {
                    return attempt.url
                        ? `${attempt.url}: ${attempt.diagnostic}`
                        : attempt.diagnostic;
                }
                const url = attempt?.url || 'asset';
                const status = attempt?.status || 'error';
                const errorMessage = attempt?.error || 'unknown error';
                return `${url} (${status}: ${errorMessage})`;
            })
            .join(' | ');
    }

    if (Array.isArray(diagnostics.queries)) {
        return diagnostics.queries.join(' | ');
    }

    return JSON.stringify(diagnostics);
}

function hideError() {
    errorBox.textContent = '';
    errorBox.classList.remove('active');
}

function setVoiceSettingsOpen(open) {
    voiceSettingsPanel.hidden = !open;
    voiceSettingsButton.setAttribute('aria-expanded', String(open));
}

function setControls() {
    const canGenerate = !runActive && !modelLoading && !styleLoading;
    const canResume = runActive && isPaused && !playbackComplete;
    const canPause = runActive && !isPaused && !playbackComplete;
    updateVisibleModelSettings();
    updateDownloadButtonLabel();
    generatePlayBtn.textContent = modelsReady
        ? 'Generate & Play'
        : (modelLoading ? `Loading ~${MODEL_DOWNLOAD_MIB} MiB…` : `Load ~${MODEL_DOWNLOAD_MIB} MiB & Play`);
    generatePlayBtn.disabled = !canGenerate;
    pauseBtn.disabled = !canPause;
    resumeBtn.disabled = !canResume;
    stickyPlayBtn.disabled = !(canGenerate || canResume);
    stickyPauseBtn.disabled = !canPause;
    stickyStopBtn.disabled = !runActive;
    stopBtn.disabled = !runActive;

    downloadBtn.disabled = !downloadUrl;
    stickyDownloadBtn.disabled = !downloadUrl;
    stickyControls.classList.toggle('visible', runActive || Boolean(downloadUrl));
    voiceStyleSelect.disabled = runActive || modelLoading || styleLoading;
    langSelect.disabled = runActive;
    totalStepInput.disabled = runActive;
    speedInput.disabled = runActive;
    fileInput.disabled = runActive;
    voiceSettingsButton.disabled = false;
    customVoiceInput.disabled = runActive || modelLoading || styleLoading;
    textInput.disabled = runActive;
    refreshActiveModelBadges();
}

function customVoiceLabel(fileName) {
    const baseName = fileName.replace(/\.json$/i, '').replace(/[_-]+/g, ' ').trim();
    return baseName ? `Custom: ${baseName}` : 'Custom voice';
}

function upsertCustomVoiceOption(fileName, objectUrl) {
    if (!customVoiceOption) {
        customVoiceOption = document.createElement('option');
        voiceStyleSelect.appendChild(customVoiceOption);
    }

    customVoiceOption.value = objectUrl;
    customVoiceOption.textContent = customVoiceLabel(fileName);
}

function clearActiveWordHighlight() {
    if (activeWordElement) {
        activeWordElement.classList.remove('active-word');
        activeWordElement = null;
    }
}

function tokenizeForWordHighlight(text, lang) {
    if ('Segmenter' in Intl) {
        try {
            const segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
            return Array.from(segmenter.segment(text), (part) => ({
                text: part.segment,
                isWord: part.isWordLike
            }));
        } catch {
            // Fall through to a whitespace-based tokenizer for unsupported locales.
        }
    }

    return text.match(/\s+|\S+/g)?.map((part) => ({
        text: part,
        isWord: /\S/.test(part)
    })) || [];
}

function appendChunkText(chunkElement, chunk, chunkIndex) {
    if (!wordHighlightEnabled) {
        chunkElement.textContent = chunk;
        return;
    }

    const tokens = tokenizeForWordHighlight(chunk, langSelect.value);
    const wordElements = [];

    for (const token of tokens) {
        if (!token.isWord) {
            chunkElement.appendChild(document.createTextNode(token.text));
            continue;
        }

        const word = document.createElement('span');
        word.className = 'reader-word';
        word.dataset.wordIndex = String(wordElements.length);
        word.textContent = token.text;
        wordElements.push(word);
        chunkElement.appendChild(word);
    }

    chunkWordElements[chunkIndex] = wordElements;
}

function getWeightedWordIndex(wordElements, progress) {
    const weights = wordElements.map((word) => Math.max(1, word.textContent.length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let target = Math.min(Math.max(progress, 0), 0.999999) * totalWeight;

    for (let index = 0; index < weights.length; index += 1) {
        target -= weights[index];
        if (target <= 0) {
            return index;
        }
    }

    return wordElements.length - 1;
}

function updateActiveWordHighlight(activeSchedule, now) {
    if (!wordHighlightEnabled || !activeSchedule) {
        clearActiveWordHighlight();
        return;
    }

    const wordElements = chunkWordElements[activeSchedule.index] || [];
    if (wordElements.length === 0) {
        clearActiveWordHighlight();
        return;
    }

    const duration = Math.max(0.001, activeSchedule.end - activeSchedule.start);
    const progress = (now - activeSchedule.start) / duration;
    const wordIndex = getWeightedWordIndex(wordElements, progress);
    const nextWordElement = wordElements[wordIndex];

    if (nextWordElement === activeWordElement) {
        return;
    }

    clearActiveWordHighlight();
    activeWordElement = nextWordElement;
    activeWordElement.classList.add('active-word');
}

function syncGeneratedChunkClasses() {
    for (const element of chunkElements) {
        const index = Number(element.dataset.index);
        const hasGeneratedAudio = Boolean(generatedChunks[index]);
        element.classList.toggle('generated', hasGeneratedAudio);
        element.title = hasGeneratedAudio
            ? 'Play from this generated chunk'
            : 'Generate and play from this chunk';
    }
}

function recalculateGeneratedStats() {
    generatedCount = 0;
    generatedAudioSeconds = 0;

    for (const generatedChunk of generatedChunks) {
        if (!generatedChunk) {
            continue;
        }

        if (generatedCount > 0) {
            generatedAudioSeconds += CHUNK_SILENCE_SECONDS;
        }

        generatedCount += 1;
        generatedAudioSeconds += generatedChunk.duration;
    }
}

function clearGeneratedAudio({ update = true } = {}) {
    generatedChunks = new Array(chunks.length);
    generatedCount = 0;
    generatedAudioSeconds = 0;
    activeChunkIndex = -1;
    playbackEndIndex = -1;
    generationComplete = false;
    playbackComplete = false;
    revokeDownloadUrl();
    clearActiveWordHighlight();
    for (const element of chunkElements) {
        element.classList.remove('active', 'complete');
    }
    syncGeneratedChunkClasses();

    if (update) {
        updateStats();
        setControls();
    }
}

function getReaderChunks() {
    const text = textInput.value.trim();
    if (!text) {
        return [];
    }

    assertTextWithinLimit(text, MAX_READER_CHARACTERS);

    const maxChunkLength = getMaxChunkLength(langSelect.value);
    return chunkText(text, maxChunkLength);
}

function rebuildReaderPreview() {
    if (runActive) {
        return;
    }

    try {
        chunks = getReaderChunks();
        hideError();
    } catch (error) {
        chunks = [];
        showError(error.message);
        setStatus(error.message, 'error', 'Input');
    }
    renderReader(chunks);
    clearGeneratedAudio({ update: false });
    updateStats();
    setControls();
}

function renderReader(nextChunks) {
    reader.replaceChildren();
    chunkElements = [];
    chunkWordElements = [];
    clearActiveWordHighlight();

    if (nextChunks.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'reader-empty';
        empty.textContent = 'Load text to build the reader.';
        reader.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    nextChunks.forEach((chunk, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'reader-chunk';
        button.dataset.index = String(index);
        button.setAttribute('aria-label', `Play from chunk ${index + 1} of ${nextChunks.length}`);
        appendChunkText(button, chunk, index);
        button.addEventListener('click', () => playFromChunk(index));
        chunkElements.push(button);
        fragment.appendChild(button);
    });

    reader.appendChild(fragment);
    syncGeneratedChunkClasses();
}

function updateReaderHighlight(index) {
    if (index === activeChunkIndex) {
        return;
    }

    clearActiveWordHighlight();
    activeChunkIndex = index;

    for (const element of chunkElements) {
        const elementIndex = Number(element.dataset.index);
        element.classList.toggle('active', elementIndex === index);
        element.classList.toggle('complete', index >= 0 && elementIndex < index);
    }

    if (index >= 0 && chunkElements[index]) {
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        chunkElements[index].scrollIntoView({
            block: 'center',
            behavior: reduceMotion ? 'auto' : 'smooth'
        });
    }
}

function markCompletedChunks(endIndex = chunks.length - 1) {
    clearActiveWordHighlight();
    for (const element of chunkElements) {
        const elementIndex = Number(element.dataset.index);
        element.classList.remove('active');
        element.classList.toggle('complete', elementIndex <= endIndex);
    }
    activeChunkIndex = -1;
}

function getElapsedPlaybackSeconds() {
    if (!audioContext || firstStartTime === null) {
        return 0;
    }

    const lastScheduled = scheduledChunks[scheduledChunks.length - 1];
    const elapsed = Math.max(0, audioContext.currentTime - firstStartTime);
    if (lastScheduled && playbackComplete) {
        return Math.max(0, lastScheduled.end - firstStartTime);
    }
    return elapsed;
}

function updateStats() {
    const totalChunks = chunks.length;
    const displayChunk = activeChunkIndex >= 0 ? activeChunkIndex + 1 : 0;
    chunkStat.textContent = `${displayChunk} / ${totalChunks}`;
    generatedStat.textContent = `${generatedCount} / ${totalChunks}`;
    elapsedStat.textContent = formatTime(getElapsedPlaybackSeconds());
    durationStat.textContent = formatTime(generatedAudioSeconds);
}

function pcmToAudioBuffer(pcm, sampleRate) {
    const buffer = audioContext.createBuffer(1, pcm.length, sampleRate);
    buffer.copyToChannel(pcm, 0);
    return buffer;
}

function stopActiveSources() {
    for (const source of activeSources) {
        try {
            source.stop();
        } catch {
            // The source may have already ended.
        }
    }

    activeSources = [];
}

function scheduleChunk(localRunId, index, generatedChunk, options = {}) {
    const buffer = pcmToAudioBuffer(generatedChunk.wav, generatedChunk.sampleRate);
    const offsetSeconds = Math.min(
        Math.max(options.offsetSeconds || 0, 0),
        Math.max(0, buffer.duration - 0.001)
    );
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    const startTime = Math.max(nextStartTime, audioContext.currentTime + START_LEAD_SECONDS);
    const endTime = startTime + Math.max(0, buffer.duration - offsetSeconds);

    source.onended = () => {
        if (localRunId !== runId) {
            return;
        }

        activeSources = activeSources.filter((activeSource) => activeSource !== source);
    };

    source.start(startTime, offsetSeconds);
    activeSources.push(source);
    scheduledChunks.push({ index, start: startTime, end: endTime, source, offset: offsetSeconds });
    playbackEndIndex = index;

    if (firstStartTime === null) {
        firstStartTime = startTime;
    }

    nextStartTime = endTime + CHUNK_SILENCE_SECONDS;
    startPlaybackLoop(localRunId);
}

function startPlaybackLoop(localRunId) {
    if (animationFrameId !== null) {
        return;
    }

    const tick = () => {
        if (localRunId !== runId || !audioContext) {
            animationFrameId = null;
            return;
        }

        const now = audioContext.currentTime;
        const activeSchedule = scheduledChunks.find((chunk) => now >= chunk.start && now < chunk.end);

        if (activeSchedule) {
            updateReaderHighlight(activeSchedule.index);
            updateActiveWordHighlight(activeSchedule, now);
        } else {
            clearActiveWordHighlight();
            const lastFinished = scheduledChunks
                .filter((chunk) => now >= chunk.end)
                .at(-1);

            if (lastFinished && activeChunkIndex !== -1) {
                updateReaderHighlight(-1);
                for (const element of chunkElements) {
                    const elementIndex = Number(element.dataset.index);
                    element.classList.toggle('complete', elementIndex <= lastFinished.index);
                }
            }
        }

        const lastScheduled = scheduledChunks[scheduledChunks.length - 1];
        const reachedEndOfText = generationComplete && lastScheduled?.index === chunks.length - 1;
        const reachedEndOfAvailableAudio = !generationActive && lastScheduled?.index === playbackEndIndex;
        if (
            lastScheduled &&
            now >= lastScheduled.end &&
            !isPaused &&
            (reachedEndOfText || reachedEndOfAvailableAudio)
        ) {
            finishPlayback();
            animationFrameId = null;
            return;
        }

        updateStats();

        animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
}

function stopPlaybackLoop() {
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

function revokeDownloadUrl() {
    if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
        downloadUrl = null;
    }
    downloadEngine = null;
}

function buildDownload() {
    revokeDownloadUrl();

    const chunksForDownload = generatedChunks.filter(Boolean);
    if (chunksForDownload.length === 0) {
        return;
    }

    downloadEngine = chunksForDownload[0].engine || getActiveEngine();
    const sampleRate = chunksForDownload[0].sampleRate;
    const silenceSamples = Math.floor(CHUNK_SILENCE_SECONDS * sampleRate);
    const totalSamples = chunksForDownload.reduce((total, chunk, index) => (
        total + chunk.wav.length + (index > 0 ? silenceSamples : 0)
    ), 0);

    const combined = new Float32Array(totalSamples);
    let offset = 0;

    chunksForDownload.forEach((chunk, index) => {
        if (index > 0) {
            offset += silenceSamples;
        }

        combined.set(chunk.wav, offset);
        offset += chunk.wav.length;
    });

    const wavBuffer = writeWavFile(combined, sampleRate);
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    downloadUrl = URL.createObjectURL(blob);
    setControls();
}

function finishPlayback() {
    playbackComplete = true;
    runActive = false;
    generationActive = false;
    isPaused = false;
    markCompletedChunks(playbackEndIndex >= 0 ? playbackEndIndex : chunks.length - 1);
    updateStats();
    setStatus(
        downloadUrl ? 'Playback complete. WAV download is ready.' : 'Playback complete.',
        'success',
        'Ready'
    );
    setControls();
}

async function resetRun(options = {}) {
    const {
        closeContext = true,
        clearAudio = true
    } = typeof options === 'boolean' ? { closeContext: options } : options;

    runId += 1;
    stopPlaybackLoop();
    stopActiveSources();
    scheduledChunks = [];
    firstStartTime = null;
    nextStartTime = 0;
    activeChunkIndex = -1;
    playbackEndIndex = -1;
    clearActiveWordHighlight();
    runActive = false;
    generationActive = false;
    generationComplete = false;
    playbackComplete = false;
    isPaused = false;

    if (clearAudio) {
        clearGeneratedAudio({ update: false });
    }

    if (audioContext && closeContext) {
        const contextToClose = audioContext;
        audioContext = null;
        try {
            await contextToClose.close();
        } catch {
            // Some browsers reject close() when the context is already closed.
        }
    }

    updateStats();
    setControls();
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

function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function scheduleGeneratedChunksFrom(localRunId, startIndex, options = {}) {
    let scheduledCount = 0;
    const startOffsetSeconds = options.startOffsetSeconds || 0;

    for (let index = startIndex; index < chunks.length; index += 1) {
        const generatedChunk = generatedChunks[index];
        if (!generatedChunk) {
            break;
        }

        scheduleChunk(localRunId, index, generatedChunk, {
            offsetSeconds: index === startIndex ? startOffsetSeconds : 0
        });
        scheduledCount += 1;
    }

    return scheduledCount;
}

async function playGeneratedFromChunk(index) {
    if (!generatedChunks[index]) {
        return false;
    }

    const keepGenerationAlive = generationActive;
    if (!keepGenerationAlive) {
        runId += 1;
    }

    const localRunId = runId;
    stopPlaybackLoop();
    stopActiveSources();
    scheduledChunks = [];
    firstStartTime = null;
    nextStartTime = 0;
    activeChunkIndex = -1;
    clearActiveWordHighlight();
    playbackComplete = false;
    isPaused = false;
    runActive = true;

    await ensureAudioContext();
    const scheduledCount = scheduleGeneratedChunksFrom(localRunId, index);

    if (scheduledCount === 0) {
        runActive = keepGenerationAlive;
        setControls();
        return false;
    }

    updateReaderHighlight(index);
    setStatus(`Playing from chunk ${index + 1} using generated audio.`, 'info', 'Playing');
    updateStats();
    setControls();
    return true;
}

async function playFromChunk(index) {
    hideError();

    if (!chunks[index]) {
        return;
    }

    if (generatedChunks[index]) {
        try {
            await playGeneratedFromChunk(index);
        } catch (error) {
            showError(error.message);
            setStatus(`Could not start playback: ${error.message}`, 'error', 'Error');
        }
        return;
    }

    if (!await ensureModelsReadyForAction()) {
        return;
    }

    setStatus(`Chunk ${index + 1} has not been generated yet. Generating from there...`, 'info', 'Generating');
    await generateAndPlay(index);
}

function textForSynthesis(chunk) {
    return normalizeForSpeech(chunk) || chunk;
}

async function disposeSupertonicInstance(instance) {
    try {
        await instance?.dispose?.();
    } catch (error) {
        console.warn('Could not release Supertonic model sessions:', error);
    }
}

async function releaseSupertonicModel({ invalidate = true, update = true } = {}) {
    if (invalidate) {
        modelLoadId += 1;
    }

    const previousTextToSpeech = textToSpeech;
    textToSpeech = null;
    currentStyle = null;
    modelsReady = false;
    modelLoading = false;
    await disposeSupertonicInstance(previousTextToSpeech);

    if (update) {
        setControls();
    }
}

async function synthesizeChunkWithActiveEngine(chunk, lang, totalStep, speed, progressCallback) {
    const synthesisText = textForSynthesis(chunk);

    const result = await textToSpeech.synthesizeChunk(
        synthesisText,
        lang,
        currentStyle,
        totalStep,
        speed,
        progressCallback
    );

    return {
        ...result,
        sampleRate: textToSpeech.sampleRate,
        engine: TTS_ENGINE_SUPERTONIC
    };
}

async function generateAndPlay(startIndex = 0) {
    hideError();

    let nextChunks;
    try {
        nextChunks = getReaderChunks();
    } catch (error) {
        showError(error.message);
        setStatus(error.message, 'error', 'Input');
        return;
    }
    if (nextChunks.length === 0) {
        showError('Choose a TXT file or enter text first.');
        return;
    }

    if (!await ensureModelsReadyForAction()) {
        return;
    }

    const boundedStartIndex = Math.min(Math.max(startIndex, 0), nextChunks.length - 1);

    await resetRun();

    chunks = nextChunks;
    renderReader(chunks);
    generatedChunks = new Array(chunks.length);
    syncGeneratedChunkClasses();

    const localRunId = runId;
    const activeEngine = TTS_ENGINE_SUPERTONIC;
    const lang = langSelect.value;
    const { totalStep, speed } = normalizedSynthesisSettings();

    runActive = true;
    generationActive = true;
    generationComplete = false;
    playbackComplete = false;
    isPaused = false;
    setControls();

    try {
        await ensureAudioContext();
        setStatus(`Generating chunk ${boundedStartIndex + 1} of ${chunks.length}...`, 'info', 'Generating');
        setProgress(boundedStartIndex, chunks.length, 'Preparing audio generation');
        await yieldToBrowser();

        for (let index = boundedStartIndex; index < chunks.length; index += 1) {
            if (localRunId !== runId) {
                return;
            }

            const chunkNumber = index + 1;
            setStatus(`Generating chunk ${chunkNumber} of ${chunks.length}...`, 'info', 'Generating');
            setControls();
            await yieldToBrowser();

            const result = await synthesizeChunkWithActiveEngine(
                chunks[index],
                lang,
                totalStep,
                speed,
                (step, total) => {
                    if (localRunId === runId && activeEngine === TTS_ENGINE_SUPERTONIC) {
                        const overallValue = index + (step / Math.max(total, 1));
                        setThrottledProgressStatus(
                            `Chunk ${chunkNumber} of ${chunks.length}: denoising ${step} of ${total}`,
                            'Generating',
                            overallValue,
                            chunks.length,
                            { force: step === total }
                        );
                    }
                }
            );

            if (localRunId !== runId) {
                return;
            }

            generatedChunks[index] = result;
            recalculateGeneratedStats();
            syncGeneratedChunkClasses();
            scheduleChunk(localRunId, index, result);
            updateStats();
            setControls();
            await yieldToBrowser();

            if (index === boundedStartIndex && !isPaused) {
                setStatus('Playback started. Generating remaining chunks...', 'info', 'Playing');
            }
        }

        if (localRunId !== runId) {
            return;
        }

        generationComplete = true;
        generationActive = false;
        buildDownload();
        setProgress(chunks.length, chunks.length, 'Audio generation complete');
        setStatus('All chunks generated. Playback is finishing...', 'info', 'Playing');
    } catch (error) {
        if (localRunId !== runId) {
            return;
        }

        await resetRun();
        renderReader(chunks);
        showError(error.message);
        setStatus(`Generation failed: ${error.message}`, 'error', 'Error');
        setProgress();
    } finally {
        setControls();
    }
}

async function pausePlayback() {
    if (!audioContext || !runActive || isPaused) {
        return;
    }

    await audioContext.suspend();
    isPaused = true;
    setStatus('Playback paused.', 'info', 'Paused');
    setControls();
}

async function resumePlayback() {
    if (!audioContext || !runActive || !isPaused) {
        return;
    }

    await audioContext.resume();
    isPaused = false;
    setStatus(generationComplete ? 'Playback resumed.' : 'Playback resumed. Generation continues...', 'info', 'Playing');
    setControls();
    startPlaybackLoop(runId);
}

async function stopCurrentRun() {
    const hadGeneratedAudio = generatedCount > 0;
    await resetRun({ clearAudio: false });
    syncGeneratedChunkClasses();
    setStatus(
        hadGeneratedAudio ? 'Stopped. Generated chunks are still available.' : 'Stopped.',
        'info',
        'Ready'
    );
    setProgress();
}

async function fetchStyleFromJSON(stylePath) {
    const resolvedStylePath = resolveVoiceStylePath(stylePath);
    return loadVoiceStyle([resolvedStylePath], true);
}

async function loadStyleFromJSON(stylePath) {
    const nextStyle = await fetchStyleFromJSON(stylePath);
    currentStylePath = stylePath;
    currentStyle = nextStyle;
    return nextStyle;
}

async function ensureModelsReadyForAction() {
    if (isActiveSynthesizerReady()) {
        return true;
    }

    if (modelLoadPromise) {
        await modelLoadPromise;
        return isActiveSynthesizerReady();
    }

    const saveDataNote = dataSaverEnabled()
        ? ' Data Saver is on; this explicit action is the only time the download starts.'
        : '';
    setStatus(
        `Loading approximately ${MODEL_DOWNLOAD_MIB} MiB of model data.${saveDataNote}`,
        'info',
        'Loading'
    );
    setProgress(0, 5, 'Loading Supertonic model data');
    await initializeModels();
    return isActiveSynthesizerReady();
}

async function initializeModels(assetSources = MODEL_SOURCE_BASE_URLS) {
    const loadId = ++modelLoadId;
    const loadPromise = initializeModelsForLoad(loadId, assetSources);
    modelLoadPromise = loadPromise;

    try {
        return await loadPromise;
    } finally {
        if (modelLoadPromise === loadPromise) {
            modelLoadPromise = null;
        }
    }
}

async function initializeModelsForLoad(loadId, assetSources = MODEL_SOURCE_BASE_URLS) {
    await releaseSupertonicModel({ invalidate: false, update: false });
    modelLoading = true;
    modelsReady = false;
    textToSpeech = null;
    currentStyle = null;
    hideError();
    setControls();

    let lastError = null;
    const sources = assetSources.length > 0 ? [...new Set(assetSources)] : [DEFAULT_ASSET_BASE_URL];
    const fetchDiagnostics = [];

    for (const baseUrl of sources) {
        activeAssetBaseUrl = baseUrl;
        const sourceLabel = assetSourceLabel(baseUrl);
        let candidateTextToSpeech = null;
        setModelSource(baseUrl, 'loading');

        try {
            setStatus(`Loading configuration from ${sourceLabel}...`, 'info', 'Loading');
            const basePath = assetUrl('onnx', baseUrl);
            let executionProvider = 'wasm';

            try {
                if (!await hasUsableWebGpu()) {
                    throw new Error('No usable WebGPU adapter is available; using WebAssembly.');
                }
                const result = await loadTextToSpeech(
                    basePath,
                    {
                        executionProviders: ['webgpu'],
                        graphOptimizationLevel: 'all'
                    },
                    (modelName, current, total) => {
                        if (loadId === modelLoadId) {
                            setThrottledProgressStatus(
                                `Loading ${sourceLabel} ONNX model ${current} of ${total}: ${modelName}`,
                                'Loading',
                                current,
                                total + 1,
                                { force: true }
                            );
                        }
                    },
                    () => loadId === modelLoadId
                );
                if (loadId !== modelLoadId) {
                    await disposeSupertonicInstance(result.textToSpeech);
                    return;
                }
                candidateTextToSpeech = result.textToSpeech;
                executionProvider = 'webgpu';
                supertonicBackendText = 'WebGPU';
                supertonicBackendUsesWebGPU = true;
                setBackendBadge(supertonicBackendText, { webgpu: true });
            } catch (webgpuError) {
                if (loadId !== modelLoadId) return;
                if (isAssetIntegrityError(webgpuError)) throw webgpuError;
                const webgpuDiagnostics = formatFetchDiagnostics(webgpuError) || String(webgpuError?.message || webgpuError);
                try {
                    const result = await loadTextToSpeech(
                        basePath,
                        {
                            executionProviders: ['wasm'],
                            graphOptimizationLevel: 'all'
                        },
                        (modelName, current, total) => {
                            if (loadId === modelLoadId) {
                                setThrottledProgressStatus(
                                    `Loading ${sourceLabel} ONNX model ${current} of ${total}: ${modelName}`,
                                    'Loading',
                                    current,
                                    total + 1,
                                    { force: true }
                                );
                            }
                        },
                        () => loadId === modelLoadId
                    );
                    if (loadId !== modelLoadId) {
                        await disposeSupertonicInstance(result.textToSpeech);
                        return;
                    }
                    candidateTextToSpeech = result.textToSpeech;
                    executionProvider = 'wasm';
                    supertonicBackendText = 'WebAssembly';
                    supertonicBackendUsesWebGPU = false;
                    setBackendBadge(supertonicBackendText);
                } catch (wasmError) {
                    if (isAssetIntegrityError(wasmError)) throw wasmError;
                    const wasmDiagnostics = formatFetchDiagnostics(wasmError) || String(wasmError?.message || wasmError);
                    const combinedError = new Error(wasmError?.message || webgpuError?.message || 'Model load failed.');
                    combinedError.fetchDiagnostics = {
                        queries: [
                            `${sourceLabel} WebGPU: ${webgpuDiagnostics}`,
                            `${sourceLabel} WASM: ${wasmDiagnostics}`
                        ],
                    };
                    throw combinedError;
                }
            }


            const stylePathForLoad = currentStylePath;
            setThrottledProgressStatus('Loading voice style...', 'Loading', 4, 5, { force: true });
            const nextStyle = await fetchStyleFromJSON(stylePathForLoad);
            if (loadId !== modelLoadId) {
                await disposeSupertonicInstance(candidateTextToSpeech);
                return;
            }

            textToSpeech = candidateTextToSpeech;
            candidateTextToSpeech = null;
            currentStylePath = stylePathForLoad;
            currentStyle = nextStyle;

            modelsReady = true;
            modelLoading = false;
            setBackendBadge(supertonicBackendText, { webgpu: supertonicBackendUsesWebGPU });
            setModelSource(baseUrl, 'ready');
            setProgress(5, 5, 'Supertonic model ready');
            setStatus(`Supertonic loaded with ${executionProvider.toUpperCase()} from ${sourceLabel}.`, 'success', 'Ready');
            setControls();
            return;
        } catch (error) {
            await disposeSupertonicInstance(candidateTextToSpeech);
            if (loadId !== modelLoadId) return;
            lastError = error;
            const diagnostics = formatFetchDiagnostics(error);
            if (diagnostics) {
                fetchDiagnostics.push(`${sourceLabel}: ${diagnostics}`);
            } else {
                fetchDiagnostics.push(`${sourceLabel}: ${error?.message || error}`);
            }
            console.warn(`Could not load Supertonic assets from ${sourceLabel}:`, error);
            textToSpeech = null;
            currentStyle = null;
            modelsReady = false;

            if (baseUrl !== sources.at(-1)) {
                setStatus(`Could not reach ${sourceLabel}; trying the next model source...`, 'info', 'Fallback');
            }
        }
    }

    modelLoading = false;
    setProgress();
    const summary = fetchDiagnostics.length
        ? `Last failures: ${fetchDiagnostics.join(' ; ')}`
        : 'No model source was available.';
    setStatus(`Model load failed: ${lastError?.message || 'No model source was available.'}`, 'error', 'Error');
    if (activeAssetBaseUrl) {
        setModelSource(activeAssetBaseUrl, 'error');
    }
    console.warn('Supertonic model fetch diagnostics:', summary);
    const userMessage = isBundledAssetSource(activeAssetBaseUrl)
        ? 'Bundled model assets could not be loaded. Serve this folder over HTTP or HTTPS and keep the assets/onnx folder next to index.html.'
        : 'CDN model assets could not be loaded. Check that the browser can reach the configured Hugging Face model source.';
    const detail = formatFetchDiagnostics(lastError) || lastError?.message || '';
    showError(detail ? `${userMessage} Details: ${detail}` : userMessage);
    const recentDiagnostics = getWebFetchDiagnostics().slice(0, 3);
    if (recentDiagnostics.length) {
        console.warn('Supertonic fetch history:', recentDiagnostics);
    }
    setControls();
}

voiceSettingsButton.addEventListener('click', () => {
    if (runActive) {
        return;
    }

    setVoiceSettingsOpen(voiceSettingsPanel.hidden);
});

document.addEventListener('click', (event) => {
    if (voiceSettingsPanel.hidden || voiceSettingsContainer.contains(event.target)) {
        return;
    }

    setVoiceSettingsOpen(false);
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !voiceSettingsPanel.hidden) {
        setVoiceSettingsOpen(false);
        voiceSettingsButton.focus();
    }
});

wordHighlightToggle.addEventListener('change', () => {
    wordHighlightEnabled = wordHighlightToggle.checked;

    const previousActiveChunkIndex = activeChunkIndex;
    renderReader(chunks);
    syncGeneratedChunkClasses();

    if (playbackComplete) {
        markCompletedChunks(playbackEndIndex >= 0 ? playbackEndIndex : chunks.length - 1);
    } else if (previousActiveChunkIndex >= 0) {
        activeChunkIndex = -1;
        updateReaderHighlight(previousActiveChunkIndex);
    }
});

customVoiceInput.addEventListener('change', async () => {
    hideError();

    const file = customVoiceInput.files?.[0];
    if (!file) {
        return;
    }

    let nextObjectUrl = null;

    try {
        assertFileWithinLimit(file, MAX_CUSTOM_VOICE_FILE_BYTES, 'Custom voice JSON');
        if (!/\.json$/i.test(file.name)) {
            throw new Error('Custom voice file must use the .json extension.');
        }
        const rawJSON = await file.text();
        const parsedVoiceStyle = JSON.parse(rawJSON);
        validateVoiceStyleObject(parsedVoiceStyle);

        nextObjectUrl = URL.createObjectURL(new Blob([rawJSON], { type: 'application/json' }));
        const nextStyle = await loadVoiceStyle([nextObjectUrl], true);

        if (customVoiceObjectUrl) {
            URL.revokeObjectURL(customVoiceObjectUrl);
        }

        customVoiceObjectUrl = nextObjectUrl;
        nextObjectUrl = null;
        upsertCustomVoiceOption(file.name, customVoiceObjectUrl);
        voiceStyleSelect.value = customVoiceObjectUrl;
        currentStylePath = customVoiceObjectUrl;
        currentStyle = nextStyle;
        clearGeneratedAudio();
        setVoiceSettingsOpen(false);
        setStatus('Custom voice loaded.', 'success');
    } catch (error) {
        if (nextObjectUrl) {
            URL.revokeObjectURL(nextObjectUrl);
        }
        customVoiceInput.value = '';
        voiceStyleSelect.value = currentStylePath;
        showError(`Could not load custom voice: ${error.message}`);
        setStatus(`Custom voice failed: ${error.message}`, 'error', 'Error');
    } finally {
        setControls();
    }
});

fileInput.addEventListener('change', async () => {
    hideError();
    const file = fileInput.files?.[0];
    if (!file) {
        return;
    }

    try {
        assertFileWithinLimit(file, MAX_TEXT_FILE_BYTES, 'TXT file');
        if (!/\.txt$/i.test(file.name)) {
            throw new Error('Reader files must use the .txt extension.');
        }
        const text = await file.text();
        assertTextWithinLimit(text, MAX_READER_CHARACTERS, 'TXT file text');
        textInput.value = text;
        rebuildReaderPreview();
        setStatus(`Loaded ${file.name}.`);
    } catch (error) {
        fileInput.value = '';
        showError(`Could not read file: ${error.message}`);
        setStatus(`TXT file rejected: ${error.message}`, 'error', 'Input');
    }
});

textInput.addEventListener('input', rebuildReaderPreview);
langSelect.addEventListener('change', rebuildReaderPreview);
function clearAudioAfterSynthesisSettingChange() {
    if (!runActive) {
        clearGeneratedAudio();
    }
}
totalStepInput.addEventListener('input', clearAudioAfterSynthesisSettingChange);
totalStepInput.addEventListener('change', clearAudioAfterSynthesisSettingChange);
speedInput.addEventListener('input', clearAudioAfterSynthesisSettingChange);
speedInput.addEventListener('change', clearAudioAfterSynthesisSettingChange);

voiceStyleSelect.addEventListener('change', async (event) => {
    hideError();
    const requestedPath = event.target.value;
    const requestId = ++styleLoadId;

    if (!modelsReady) {
        currentStylePath = requestedPath;
        currentStyle = null;
        clearGeneratedAudio();
        setStatus('Voice selected. Its style will load with the model after you press Play.', 'info', 'Ready');
        setControls();
        return;
    }

    try {
        styleLoading = true;
        setControls();
        setStatus('Loading voice style...', 'info', 'Loading');
        const nextStyle = await fetchStyleFromJSON(requestedPath);
        if (requestId !== styleLoadId) {
            return;
        }
        currentStylePath = requestedPath;
        currentStyle = nextStyle;
        clearGeneratedAudio();
        setStatus('Voice style loaded.', 'success');
    } catch (error) {
        if (requestId !== styleLoadId) {
            return;
        }
        showError(`Could not load voice style: ${error.message}`);
        voiceStyleSelect.value = currentStylePath;
    } finally {
        if (requestId === styleLoadId) {
            styleLoading = false;
        }
        setControls();
    }
});

generatePlayBtn.addEventListener('click', () => generateAndPlay());
pauseBtn.addEventListener('click', pausePlayback);
resumeBtn.addEventListener('click', resumePlayback);
stopBtn.addEventListener('click', stopCurrentRun);
stickyPlayBtn.addEventListener('click', () => {
    if (runActive && isPaused) {
        resumePlayback();
        return;
    }

    generateAndPlay();
});
stickyPauseBtn.addEventListener('click', pausePlayback);
stickyStopBtn.addEventListener('click', stopCurrentRun);
function downloadGeneratedWav() {
    if (!downloadUrl) {
        return;
    }

    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = getDownloadFileName();
    anchor.click();
}

downloadBtn.addEventListener('click', downloadGeneratedWav);
stickyDownloadBtn.addEventListener('click', downloadGeneratedWav);

window.addEventListener('beforeunload', () => {
    revokeDownloadUrl();
    if (customVoiceObjectUrl) {
        URL.revokeObjectURL(customVoiceObjectUrl);
    }
    for (const source of activeSources) {
        try {
            source.stop();
        } catch {
            // Ignore already-ended sources during page unload.
        }
    }
});

async function registerServiceWorker() {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) {
        return;
    }

    try {
        const buildId = typeof __SUPERTONIC_BUILD_ID__ === 'undefined'
            ? 'development'
            : __SUPERTONIC_BUILD_ID__;
        await navigator.serviceWorker.register(`./sw.js?build=${encodeURIComponent(buildId)}`);
    } catch (error) {
        console.warn('Service worker registration failed:', error);
    }
}

window.addEventListener('load', () => {
    rebuildReaderPreview();
    modelSourceBadge.textContent = 'Model: not loaded';
    modelSourceBadge.className = 'source-badge visible deferred';
    const saveDataNote = dataSaverEnabled()
        ? ' Data Saver is on, so no model data will download until you press Play.'
        : '';
    setStatus(
        `Ready. The approximately ${MODEL_DOWNLOAD_MIB} MiB model loads only when you press Generate & Play.${saveDataNote}`,
        'info',
        'Ready'
    );
    setProgress();
    setControls();
    registerServiceWorker();
});
