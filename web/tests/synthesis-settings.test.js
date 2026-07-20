import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [mainSource, voicesSource, voicesHtml] = await Promise.all([
    readFile(new URL('../main.js', import.meta.url), 'utf8'),
    readFile(new URL('../voices.js', import.meta.url), 'utf8'),
    readFile(new URL('../voices.html', import.meta.url), 'utf8'),
]);

test('reader clamps synthesis settings before generation', () => {
    assert.match(mainSource, /const TOTAL_STEP_MIN = 1;/);
    assert.match(mainSource, /const TOTAL_STEP_MAX = 50;/);
    assert.match(mainSource, /const TOTAL_STEP_DEFAULT = 8;/);
    assert.match(mainSource, /const SPEED_MIN = 0\.5;/);
    assert.match(mainSource, /const SPEED_MAX = 2;/);
    assert.match(mainSource, /const SPEED_DEFAULT = 1\.05;/);
    assert.match(mainSource, /function normalizedSynthesisSettings\(\)/);
    assert.match(mainSource, /const \{ totalStep, speed \} = normalizedSynthesisSettings\(\);/);
});

test('voice comparison uses the same synthesis ranges as the reader', () => {
    assert.match(voicesSource, /Math\.max\(1, Math\.min\(50, steps\)\) : 8/);
    assert.match(voicesSource, /Math\.max\(0\.5, Math\.min\(2, speed\)\) : 1\.05/);
    assert.match(voicesHtml, /id="stepInput" type="number" min="1" max="50" value="8"/);
    assert.match(voicesHtml, /id="speedInput" type="number" min="0\.5" max="2" step="0\.05" value="1\.05"/);
});
