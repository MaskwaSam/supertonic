import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateCliInputs } from './text-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
    const args = {
        useGpu: false,
        onnxDir: '../assets/onnx',
        totalStep: 8,
        speed: 1.05,
        nTest: 4,
        voiceStyle: ['../assets/voice_styles/M1.json'],
        text: ['This morning, I took a walk in the park, and the sound of the birds and the breeze was so pleasant that I stopped for a long time just to listen.'],
        lang: ['en'],
        saveDir: 'results',
        batch: false
    };

    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg === '--use-gpu') {
            args.useGpu = true;
        } else if (arg === '--batch') {
            args.batch = true;
        } else if (arg === '--onnx-dir' && i + 1 < process.argv.length) {
            args.onnxDir = process.argv[++i];
        } else if (arg === '--total-step' && i + 1 < process.argv.length) {
            args.totalStep = Number(process.argv[++i]);
        } else if (arg === '--speed' && i + 1 < process.argv.length) {
            args.speed = Number(process.argv[++i]);
        } else if (arg === '--n-test' && i + 1 < process.argv.length) {
            args.nTest = Number(process.argv[++i]);
        } else if (arg === '--voice-style' && i + 1 < process.argv.length) {
            args.voiceStyle = process.argv[++i].split(',');
        } else if (arg === '--text' && i + 1 < process.argv.length) {
            args.text = process.argv[++i].split('|');
        } else if (arg === '--lang' && i + 1 < process.argv.length) {
            args.lang = process.argv[++i].split(',');
        } else if (arg === '--save-dir' && i + 1 < process.argv.length) {
            args.saveDir = process.argv[++i];
        }
    }

    return args;
}

async function main() {
    console.log('=== TTS Inference with ONNX Runtime (Node.js) ===\n');

    const args = parseArgs();
    const totalStep = args.totalStep;
    const speed = args.speed;
    const nTest = args.nTest;
    const saveDir = args.saveDir;
    const voiceStylePaths = args.voiceStyle.map(p => path.resolve(__dirname, p));
    const textList = args.text;
    const langList = args.lang;
    const batch = args.batch;

    validateCliInputs({ totalStep, speed, nTest, text: textList, lang: langList });

    if (batch) {
        if (voiceStylePaths.length !== textList.length) {
            throw new Error(`Number of voice styles (${voiceStylePaths.length}) must match number of texts (${textList.length})`);
        }
        if (langList.length !== textList.length) {
            throw new Error(`Number of languages (${langList.length}) must match number of texts (${textList.length})`);
        }
    } else if (voiceStylePaths.length !== 1 || textList.length !== 1 || langList.length !== 1) {
        throw new Error('Multiple voice styles, texts, or languages require --batch');
    }
    const bsz = batch ? voiceStylePaths.length : 1;

    // Import runtime/model dependencies only after every CLI input is valid.
    const { loadTextToSpeech, loadVoiceStyle, timer, writeWavFile, sanitizeFilename } = await import('./helper.js');

    const onnxDir = path.resolve(__dirname, args.onnxDir);
    const textToSpeech = await loadTextToSpeech(onnxDir, args.useGpu);
    const style = loadVoiceStyle(voiceStylePaths, true);

    for (let n = 0; n < nTest; n++) {
        console.log(`\n[${n + 1}/${nTest}] Starting synthesis...`);

        const { wav, duration } = await timer('Generating speech from text', async () => {
            if (batch) {
                return await textToSpeech.batch(textList, langList, style, totalStep, speed);
            } else {
                return await textToSpeech.call(textList[0], langList[0], style, totalStep, speed);
            }
        });

        if (!fs.existsSync(saveDir)) {
            fs.mkdirSync(saveDir, { recursive: true });
        }

        const wavShape = [bsz, wav.length / bsz];
        for (let b = 0; b < bsz; b++) {
            const fname = `${sanitizeFilename(textList[b], 20)}_${n + 1}.wav`;
            const wavLen = Math.floor(textToSpeech.sampleRate * duration[b]);
            const wavOut = wav.slice(b * wavShape[1], b * wavShape[1] + wavLen);

            const outputPath = path.join(saveDir, fname);
            writeWavFile(outputPath, wavOut, textToSpeech.sampleRate);
            console.log(`Saved: ${outputPath}`);
        }
    }

    console.log('\n=== Synthesis completed successfully! ===');
}

main().catch(err => {
    console.error('Error during inference:', err);
    process.exit(1);
});
