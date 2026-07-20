import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkText, validateCliInputs } from './text-utils.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, '..', 'tests', 'conformance', 'conformance.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

for (const testCase of fixture.chunking) {
    const actual = chunkText(testCase.text, testCase.max_len);
    assert.deepEqual(actual, testCase.expected, testCase.name);
    assert.ok(actual.every(chunk => Array.from(chunk).length <= testCase.max_len), testCase.name);
}

const baseline = { totalStep: 8, speed: 1.05, nTest: 1, text: ['Hello.'], lang: ['en'] };
for (const testCase of fixture.invalid_cli) {
    const value = testCase.value === 'NaN' ? Number.NaN : testCase.value;
    const key = { total_step: 'totalStep', n_test: 'nTest' }[testCase.field] ?? testCase.field;
    const input = { ...baseline, [key]: ['text', 'lang'].includes(key) ? [value] : value };
    assert.throws(() => validateCliInputs(input), undefined, testCase.name);
}
assert.doesNotThrow(() => validateCliInputs(baseline));
console.log(`Node conformance: ${fixture.chunking.length} chunking and ${fixture.invalid_cli.length} invalid CLI cases passed`);
