import {
    chunkText,
    loadTextToSpeech,
    loadVoiceStyle,
    writeWavFile
} from './helper.js';

const DEFAULT_VOICE_STYLE_PATH = 'assets/voice_styles/M1.json';
const CHUNK_SILENCE_SECONDS = 0.3;
const START_LEAD_SECONDS = 0.08;

let textToSpeech = null;
let currentStyle = null;
let currentStylePath = DEFAULT_VOICE_STYLE_PATH;
let modelsReady = false;

let runId = 0;
let runActive = false;
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
const statusBox = document.getElementById('statusBox');
const statusText = document.getElementById('statusText');
const backendBadge = document.getElementById('backendBadge');
const errorBox = document.getElementById('error');
const reader = document.getElementById('reader');
const chunkStat = document.getElementById('chunkStat');
const generatedStat = document.getElementById('generatedStat');
const elapsedStat = document.getElementById('elapsedStat');
const durationStat = document.getElementById('durationStat');

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

function setStatus(message, type = 'info') {
    statusText.textContent = message;
    statusBox.className = `status-box ${type}`;
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
    generatedCount = 0;
    generatedAudioSeconds = 0;
    updateStats();
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
        span.textContent = chunk;
        chunkElements.push(span);
        fragment.appendChild(span);
    });

    reader.appendChild(fragment);
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

function markCompletedChunks() {
    for (const element of chunkElements) {
        element.classList.remove('active');
        element.classList.add('complete');
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
        if (
            generationComplete &&
            lastScheduled &&
            scheduledChunks.length === chunks.length &&
            now >= lastScheduled.end &&
            !isPaused
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
    const totalSamples = generatedChunks.reduce((total, chunk, index) => {
        if (!chunk) {
            return total;
        }
        return total + chunk.wav.length + (index > 0 ? silenceSamples : 0);
    }, 0);

    const combined = new Float32Array(totalSamples);
    let offset = 0;

    generatedChunks.forEach((chunk, index) => {
        if (!chunk) {
            return;
        }

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
    isPaused = false;
    markCompletedChunks();
    updateStats();
    setStatus('Playback complete. WAV download is ready.', 'success');
    setControls();
}

async function resetRun(closeContext = true) {
    runId += 1;
    stopPlaybackLoop();

    for (const source of activeSources) {
        try {
            source.stop();
        } catch {
            // The source may have already ended.
        }
    }

    activeSources = [];
    scheduledChunks = [];
    generatedChunks = [];
    generatedCount = 0;
    generatedAudioSeconds = 0;
    firstStartTime = null;
    nextStartTime = 0;
    activeChunkIndex = -1;
    runActive = false;
    generationComplete = false;
    playbackComplete = false;
    isPaused = false;
    revokeDownloadUrl();

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

    audioContext = new AudioContextCtor();
    await audioContext.resume();
}

async function generateAndPlay() {
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

    await resetRun();

    chunks = nextChunks;
    renderReader(chunks);
    generatedChunks = new Array(chunks.length);

    const localRunId = runId;
    const lang = langSelect.value;
    const totalStep = Number.parseInt(totalStepInput.value, 10);
    const speed = Number.parseFloat(speedInput.value);

    runActive = true;
    generationComplete = false;
    playbackComplete = false;
    isPaused = false;
    setControls();

    try {
        await ensureAudioContext();
        setStatus(`Generating chunk 1 of ${chunks.length}...`);

        for (let index = 0; index < chunks.length; index += 1) {
            if (localRunId !== runId) {
                return;
            }

            const chunkNumber = index + 1;
            setStatus(`Generating chunk ${chunkNumber} of ${chunks.length}...`);

            const result = await textToSpeech.synthesizeChunk(
                chunks[index],
                lang,
                currentStyle,
                totalStep,
                speed,
                (step, total) => {
                    if (localRunId === runId) {
                        setStatus(`Chunk ${chunkNumber} of ${chunks.length}: denoising ${step} of ${total}`);
                    }
                }
            );

            if (localRunId !== runId) {
                return;
            }

            generatedChunks[index] = result;
            generatedCount += 1;
            generatedAudioSeconds += result.duration + (index > 0 ? CHUNK_SILENCE_SECONDS : 0);
            scheduleChunk(localRunId, index, result.wav);
            updateStats();

            if (index === 0) {
                setStatus('Playback started. Generating remaining chunks...');
            }
        }

        if (localRunId !== runId) {
            return;
        }

        generationComplete = true;
        buildDownload();
        setStatus('All chunks generated. Playback is finishing...');
    } catch (error) {
        if (localRunId !== runId) {
            return;
        }

        await resetRun();
        renderReader(chunks);
        showError(error.message);
        setStatus(`Generation failed: ${error.message}`, 'error');
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
    setStatus('Playback paused.');
    setControls();
}

async function resumePlayback() {
    if (!audioContext || !runActive || !isPaused) {
        return;
    }

    await audioContext.resume();
    isPaused = false;
    setStatus(generationComplete ? 'Playback resumed.' : 'Playback resumed. Generation continues...');
    setControls();
    startPlaybackLoop(runId);
}

async function stopCurrentRun() {
    await resetRun();
    rebuildReaderPreview();
    setStatus(modelsReady ? 'Stopped.' : 'Loading models...');
}

async function loadStyleFromJSON(stylePath) {
    const nextStyle = await loadVoiceStyle([stylePath], true);
    currentStylePath = stylePath;
    currentStyle = nextStyle;
}

async function initializeModels() {
    try {
        setStatus('Loading configuration...');
        const basePath = 'assets/onnx';
        let executionProvider = 'wasm';

        try {
            const result = await loadTextToSpeech(
                basePath,
                {
                    executionProviders: ['webgpu'],
                    graphOptimizationLevel: 'all'
                },
                (modelName, current, total) => {
                    setStatus(`Loading ONNX model ${current} of ${total}: ${modelName}`);
                }
            );
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
                    setStatus(`Loading ONNX model ${current} of ${total}: ${modelName}`);
                }
            );
            textToSpeech = result.textToSpeech;
            backendBadge.textContent = 'WebAssembly';
        }

        setStatus('Loading voice style...');
        await loadStyleFromJSON(currentStylePath);

        modelsReady = true;
        backendBadge.classList.add('visible');
        setStatus(`Models loaded with ${executionProvider.toUpperCase()}.`, 'success');
    } catch (error) {
        modelsReady = false;
        setStatus(`Model load failed: ${error.message}`, 'error');
        showError('Model assets were not found or could not be loaded. Check that assets/onnx and assets/voice_styles exist.');
    } finally {
        setControls();
    }
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

voiceStyleSelect.addEventListener('change', async (event) => {
    hideError();

    try {
        setControls();
        generatePlayBtn.disabled = true;
        setStatus('Loading voice style...');
        await loadStyleFromJSON(event.target.value);
        setStatus('Voice style loaded.', 'success');
    } catch (error) {
        showError(`Could not load voice style: ${error.message}`);
        voiceStyleSelect.value = currentStylePath;
    } finally {
        setControls();
    }
});

generatePlayBtn.addEventListener('click', generateAndPlay);
pauseBtn.addEventListener('click', pausePlayback);
resumeBtn.addEventListener('click', resumePlayback);
stopBtn.addEventListener('click', stopCurrentRun);
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

window.addEventListener('load', async () => {
    rebuildReaderPreview();
    setControls();
    await initializeModels();
});
