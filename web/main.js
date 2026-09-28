import {
    chunkText,
    loadTextToSpeech,
    loadVoiceStyle,
    writeWavFile
} from './helper.js';

const DEFAULT_ASSET_BASE_URL = 'assets';
const ASSET_BASE_URLS = (
    import.meta.env.VITE_SUPERTONIC_ASSET_BASE_URLS ||
    import.meta.env.VITE_SUPERTONIC_ASSET_BASE_URL ||
    DEFAULT_ASSET_BASE_URL
)
    .split(',')
    .map((baseUrl) => baseUrl.trim().replace(/\/$/, ''))
    .filter(Boolean);
const DEFAULT_VOICE_STYLE_PATH = 'assets/voice_styles/M1.json';
const CHUNK_SILENCE_SECONDS = 0.3;
const START_LEAD_SECONDS = 0.08;

let textToSpeech = null;
let currentStyle = null;
let currentStylePath = DEFAULT_VOICE_STYLE_PATH;
let activeAssetBaseUrl = ASSET_BASE_URLS[0] || DEFAULT_ASSET_BASE_URL;
let modelsReady = false;
let modelLoading = false;
let modelLoadId = 0;

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

const fileInput = document.getElementById('fileInput');
const textInput = document.getElementById('text');
const voiceStyleSelect = document.getElementById('voiceStyleSelect');
const langSelect = document.getElementById('langSelect');
const totalStepInput = document.getElementById('totalStep');
const speedInput = document.getElementById('speed');
const generatePlayBtn = document.getElementById('generatePlayBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');
const useBundledBtn = document.getElementById('useBundledBtn');
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

function assetUrl(path, baseUrl = activeAssetBaseUrl) {
    return `${baseUrl}/${path.replace(/^assets\//, '')}`;
}

function resolveAssetPath(path, baseUrl = activeAssetBaseUrl) {
    if (/^https?:\/\//.test(path)) {
        return path;
    }

    return assetUrl(path, baseUrl);
}

function assetSourceLabel(baseUrl) {
    return /^https?:\/\//.test(baseUrl) ? 'CDN' : 'bundled model';
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

function setStatus(message, type = 'info', phase = null) {
    if (phase) {
        statusPhase.textContent = phase;
    }
    statusText.textContent = message;
    statusBox.className = `status-box ${type}`;
}

function setModelSource(baseUrl, state = 'ready') {
    const bundled = isBundledAssetSource(baseUrl);
    const sourceName = bundled ? 'Bundled' : 'CDN';
    const stateLabel = state === 'loading' ? 'loading' : sourceName;

    modelSourceBadge.textContent = state === 'loading'
        ? `Model: ${sourceName}...`
        : `Model: ${stateLabel}`;
    modelSourceBadge.className = 'source-badge visible';
    modelSourceBadge.classList.add(bundled ? 'bundled' : 'cdn');
}

function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('active');
}

function hideError() {
    errorBox.textContent = '';
    errorBox.classList.remove('active');
}

function setControls() {
    const canGenerate = modelsReady && currentStyle && !runActive;
    generatePlayBtn.disabled = !canGenerate;
    pauseBtn.disabled = !runActive || isPaused || playbackComplete;
    resumeBtn.disabled = !runActive || !isPaused || playbackComplete;
    stopBtn.disabled = !runActive;
    downloadBtn.disabled = !downloadUrl;
    voiceStyleSelect.disabled = runActive;
    langSelect.disabled = runActive;
    totalStepInput.disabled = runActive;
    speedInput.disabled = runActive;
    fileInput.disabled = runActive;
    textInput.disabled = runActive;
    useBundledBtn.disabled = runActive || (isBundledAssetSource() && (modelsReady || modelLoading));
}

function syncGeneratedChunkClasses() {
    for (const element of chunkElements) {
        const index = Number(element.dataset.index);
        const hasGeneratedAudio = Boolean(generatedChunks[index]);
        element.classList.toggle('generated', hasGeneratedAudio);
        element.title = hasGeneratedAudio
            ? 'Double-click to play from this generated chunk'
            : 'Double-click to generate and play from this chunk';
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

    return chunkText(text, getMaxChunkLength(langSelect.value));
}

function rebuildReaderPreview() {
    if (runActive) {
        return;
    }

    chunks = getReaderChunks();
    renderReader(chunks);
    clearGeneratedAudio({ update: false });
    updateStats();
    setControls();
}

function renderReader(nextChunks) {
    reader.replaceChildren();
    chunkElements = [];

    if (nextChunks.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'reader-empty';
        empty.textContent = 'Load text to build the reader.';
        reader.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    nextChunks.forEach((chunk, index) => {
        const span = document.createElement('span');
        span.className = 'reader-chunk';
        span.dataset.index = String(index);
        span.tabIndex = 0;
        span.textContent = chunk;
        span.addEventListener('dblclick', () => playFromChunk(index));
        span.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                playFromChunk(index);
            }
        });
        chunkElements.push(span);
        fragment.appendChild(span);
    });

    reader.appendChild(fragment);
    syncGeneratedChunkClasses();
}

function updateReaderHighlight(index) {
    if (index === activeChunkIndex) {
        return;
    }

    activeChunkIndex = index;

    for (const element of chunkElements) {
        const elementIndex = Number(element.dataset.index);
        element.classList.toggle('active', elementIndex === index);
        element.classList.toggle('complete', index >= 0 && elementIndex < index);
    }

    if (index >= 0 && chunkElements[index]) {
        chunkElements[index].scrollIntoView({
            block: 'center',
            behavior: 'smooth'
        });
    }
}

function markCompletedChunks(endIndex = chunks.length - 1) {
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

function pcmToAudioBuffer(pcm) {
    const buffer = audioContext.createBuffer(1, pcm.length, textToSpeech.sampleRate);
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

function scheduleChunk(localRunId, index, wav) {
    const buffer = pcmToAudioBuffer(wav);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    const startTime = Math.max(nextStartTime, audioContext.currentTime + START_LEAD_SECONDS);
    const endTime = startTime + buffer.duration;

    source.onended = () => {
        if (localRunId !== runId) {
            return;
        }

        activeSources = activeSources.filter((activeSource) => activeSource !== source);
    };

    source.start(startTime);
    activeSources.push(source);
    scheduledChunks.push({ index, start: startTime, end: endTime, source });
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
        } else {
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
}

function buildDownload() {
    revokeDownloadUrl();

    const sampleRate = textToSpeech.sampleRate;
    const silenceSamples = Math.floor(CHUNK_SILENCE_SECONDS * sampleRate);
    const chunksForDownload = generatedChunks.filter(Boolean);
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

function scheduleGeneratedChunksFrom(localRunId, startIndex) {
    let scheduledCount = 0;

    for (let index = startIndex; index < chunks.length; index += 1) {
        const generatedChunk = generatedChunks[index];
        if (!generatedChunk) {
            break;
        }

        scheduleChunk(localRunId, index, generatedChunk.wav);
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

    if (!modelsReady || !currentStyle) {
        showError('Models and voice style are not ready yet.');
        return;
    }

    setStatus(`Chunk ${index + 1} has not been generated yet. Generating from there...`, 'info', 'Generating');
    await generateAndPlay(index);
}

async function generateAndPlay(startIndex = 0) {
    hideError();

    if (!textToSpeech || !currentStyle) {
        showError('Models and voice style are not ready yet.');
        return;
    }

    const nextChunks = getReaderChunks();
    if (nextChunks.length === 0) {
        showError('Choose a TXT file or enter text first.');
        return;
    }

    const boundedStartIndex = Math.min(Math.max(startIndex, 0), nextChunks.length - 1);

    await resetRun();

    chunks = nextChunks;
    renderReader(chunks);
    generatedChunks = new Array(chunks.length);
    syncGeneratedChunkClasses();

    const localRunId = runId;
    const lang = langSelect.value;
    const totalStep = Number.parseInt(totalStepInput.value, 10);
    const speed = Number.parseFloat(speedInput.value);

    runActive = true;
    generationActive = true;
    generationComplete = false;
    playbackComplete = false;
    isPaused = false;
    setControls();

    try {
        await ensureAudioContext();
        setStatus(`Generating chunk ${boundedStartIndex + 1} of ${chunks.length}...`, 'info', 'Generating');

        for (let index = boundedStartIndex; index < chunks.length; index += 1) {
            if (localRunId !== runId) {
                return;
            }

            const chunkNumber = index + 1;
            setStatus(`Generating chunk ${chunkNumber} of ${chunks.length}...`, 'info', 'Generating');

            const result = await textToSpeech.synthesizeChunk(
                chunks[index],
                lang,
                currentStyle,
                totalStep,
                speed,
                (step, total) => {
                    if (localRunId === runId) {
                        setStatus(`Chunk ${chunkNumber} of ${chunks.length}: denoising ${step} of ${total}`, 'info', 'Generating');
                    }
                }
            );

            if (localRunId !== runId) {
                return;
            }

            generatedChunks[index] = result;
            recalculateGeneratedStats();
            syncGeneratedChunkClasses();
            scheduleChunk(localRunId, index, result.wav);
            updateStats();

            if (index === boundedStartIndex) {
                setStatus('Playback started. Generating remaining chunks...', 'info', 'Playing');
            }
        }

        if (localRunId !== runId) {
            return;
        }

        generationComplete = true;
        generationActive = false;
        buildDownload();
        setStatus('All chunks generated. Playback is finishing...', 'info', 'Playing');
    } catch (error) {
        if (localRunId !== runId) {
            return;
        }

        await resetRun();
        renderReader(chunks);
        showError(error.message);
        setStatus(`Generation failed: ${error.message}`, 'error', 'Error');
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
        modelsReady ? 'Ready' : 'Loading'
    );
}

async function loadStyleFromJSON(stylePath, baseUrl = activeAssetBaseUrl) {
    const resolvedStylePath = resolveAssetPath(stylePath, baseUrl);
    const nextStyle = await loadVoiceStyle([resolvedStylePath], true);
    currentStylePath = stylePath;
    currentStyle = nextStyle;
}

async function initializeModels(assetSources = ASSET_BASE_URLS) {
    const loadId = ++modelLoadId;
    modelLoading = true;
    modelsReady = false;
    textToSpeech = null;
    currentStyle = null;
    hideError();
    setControls();

    let lastError = null;
    const sources = assetSources.length > 0 ? assetSources : [DEFAULT_ASSET_BASE_URL];

    for (const baseUrl of sources) {
        activeAssetBaseUrl = baseUrl;
        const sourceLabel = assetSourceLabel(baseUrl);
        setModelSource(baseUrl, 'loading');

        try {
            setStatus(`Loading configuration from ${sourceLabel}...`, 'info', 'Loading');
            const basePath = assetUrl('onnx', baseUrl);
            let executionProvider = 'wasm';

            try {
                const result = await loadTextToSpeech(
                    basePath,
                    {
                        executionProviders: ['webgpu'],
                    graphOptimizationLevel: 'all'
                },
                (modelName, current, total) => {
                        if (loadId === modelLoadId) {
                            setStatus(`Loading ${sourceLabel} ONNX model ${current} of ${total}: ${modelName}`, 'info', 'Loading');
                        }
                    }
                );
                if (loadId !== modelLoadId) return;
                textToSpeech = result.textToSpeech;
                executionProvider = 'webgpu';
                backendBadge.textContent = 'WebGPU';
                backendBadge.classList.add('webgpu');
            } catch (webgpuError) {
                const result = await loadTextToSpeech(
                    basePath,
                    {
                        executionProviders: ['wasm'],
                    graphOptimizationLevel: 'all'
                },
                (modelName, current, total) => {
                        if (loadId === modelLoadId) {
                            setStatus(`Loading ${sourceLabel} ONNX model ${current} of ${total}: ${modelName}`, 'info', 'Loading');
                        }
                    }
                );
                if (loadId !== modelLoadId) return;
                textToSpeech = result.textToSpeech;
                executionProvider = 'wasm';
                backendBadge.textContent = 'WebAssembly';
                backendBadge.classList.remove('webgpu');
            }

            setStatus(`Loading voice style from ${sourceLabel}...`, 'info', 'Loading');
            await loadStyleFromJSON(currentStylePath, baseUrl);
            if (loadId !== modelLoadId) return;

            modelsReady = true;
            modelLoading = false;
            backendBadge.classList.add('visible');
            setModelSource(baseUrl, 'ready');
            setStatus(`Models loaded with ${executionProvider.toUpperCase()} from ${sourceLabel}.`, 'success', 'Ready');
            setControls();
            return;
        } catch (error) {
            if (loadId !== modelLoadId) return;
            lastError = error;
            console.warn(`Could not load Supertonic assets from ${sourceLabel}:`, error);
            textToSpeech = null;
            currentStyle = null;
            modelsReady = false;

            if (baseUrl !== sources.at(-1)) {
                setStatus(`Could not reach ${sourceLabel}; trying bundled model...`, 'info', 'Fallback');
            }
        }
    }

    modelLoading = false;
    setStatus(`Model load failed: ${lastError?.message || 'No model source was available.'}`, 'error', 'Error');
    showError('Model assets could not be loaded from the CDN or the bundled assets folder.');
    setControls();
}

async function useBundledModel() {
    if (runActive) {
        return;
    }

    await resetRun();
    rebuildReaderPreview();
    setStatus('Switching to bundled model...', 'info', 'Loading');
    await initializeModels([DEFAULT_ASSET_BASE_URL], 'manual');
}

fileInput.addEventListener('change', async () => {
    hideError();
    const file = fileInput.files?.[0];
    if (!file) {
        return;
    }

    try {
        const text = await file.text();
        textInput.value = text;
        rebuildReaderPreview();
        setStatus(`Loaded ${file.name}.`);
    } catch (error) {
        showError(`Could not read file: ${error.message}`);
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

    try {
        setControls();
        generatePlayBtn.disabled = true;
        setStatus('Loading voice style...');
        await loadStyleFromJSON(event.target.value);
        clearGeneratedAudio();
        setStatus('Voice style loaded.', 'success');
    } catch (error) {
        showError(`Could not load voice style: ${error.message}`);
        voiceStyleSelect.value = currentStylePath;
    } finally {
        setControls();
    }
});

generatePlayBtn.addEventListener('click', () => generateAndPlay());
pauseBtn.addEventListener('click', pausePlayback);
resumeBtn.addEventListener('click', resumePlayback);
stopBtn.addEventListener('click', stopCurrentRun);
useBundledBtn.addEventListener('click', useBundledModel);
downloadBtn.addEventListener('click', () => {
    if (!downloadUrl) {
        return;
    }

    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = 'supertonic-reader.wav';
    anchor.click();
});

window.addEventListener('beforeunload', () => {
    revokeDownloadUrl();
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
        await navigator.serviceWorker.register('./sw.js');
    } catch (error) {
        console.warn('Service worker registration failed:', error);
    }
}

window.addEventListener('load', async () => {
    rebuildReaderPreview();
    setControls();
    registerServiceWorker();
    await initializeModels();
});
