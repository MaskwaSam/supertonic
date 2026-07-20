import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assertFileWithinLimit,
    assertTextWithinLimit,
    dataSaverEnabled,
    splitUnicode,
    unicodeLength,
    validateVoiceStyleObject,
} from '../runtime-policy.js';

function tensor(dimensions, value = 0) {
    const build = (depth) => (
        depth === dimensions.length
            ? value
            : Array.from({ length: dimensions[depth] }, () => build(depth + 1))
    );
    return { type: 'float32', dims: dimensions, data: build(0) };
}

function validStyle() {
    return {
        style_ttl: tensor([1, 50, 256], 0.25),
        style_dp: tensor([1, 8, 16], -0.25),
    };
}

test('Unicode length and splitting preserve grapheme clusters', () => {
    const text = 'A😀é👩‍🚀B';
    assert.equal(unicodeLength(text), 5);
    assert.deepEqual(splitUnicode(text, 2), ['A😀', 'é👩‍🚀', 'B']);
});

test('text and file limits fail with actionable messages', () => {
    assert.equal(assertTextWithinLimit('okay', 4), 4);
    assert.throws(() => assertTextWithinLimit('too long', 3), /the limit is 3/);
    assert.doesNotThrow(() => assertFileWithinLimit({ size: 1024 }, 1024, 'TXT file'));
    assert.throws(() => assertFileWithinLimit({ size: 1025 }, 1024, 'TXT file'), /too large/);
});

test('voice validation accepts exact finite float32 tensors', () => {
    const flattened = validateVoiceStyleObject(validStyle());
    assert.equal(flattened.style_ttl.length, 12_800);
    assert.equal(flattened.style_dp.length, 128);
});

test('voice validation rejects wrong dimensions, ragged data, and non-finite values', () => {
    const wrongDimensions = validStyle();
    wrongDimensions.style_dp.dims = [1, 8, 15];
    assert.throws(() => validateVoiceStyleObject(wrongDimensions), /dims must be/);

    const ragged = validStyle();
    ragged.style_dp.data[0][0].pop();
    assert.throws(() => validateVoiceStyleObject(ragged), /does not match dimensions/);

    const nonFinite = validStyle();
    nonFinite.style_dp.data[0][0][0] = Infinity;
    assert.throws(() => validateVoiceStyleObject(nonFinite), /finite numbers/);
});

test('save-data detection is explicit and null-safe', () => {
    assert.equal(dataSaverEnabled({ saveData: true }), true);
    assert.equal(dataSaverEnabled({ saveData: false }), false);
    assert.equal(dataSaverEnabled(undefined), false);
});
