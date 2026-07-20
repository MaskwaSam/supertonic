import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkText } from '../helper.js';
import { unicodeLength } from '../runtime-policy.js';

test('chunkText never exceeds the hard Unicode-aware limit', () => {
    const text = `${'👩‍🚀'.repeat(17)} ${'unbroken'.repeat(40)}. Ending sentence.`;
    const chunks = chunkText(text, 25, 1_000);
    assert.ok(chunks.length > 2);
    assert.ok(chunks.every((chunk) => unicodeLength(chunk) <= 25));
    assert.ok(chunks.join(' ').includes('Ending sentence.'));
});

test('chunkText keeps normal sentence and paragraph boundaries readable', () => {
    assert.deepEqual(
        chunkText('Dr. Jones arrived. The class began.\n\nA new paragraph.', 40),
        ['Dr. Jones arrived. The class began.', 'A new paragraph.']
    );
});

test('chunkText rejects invalid limits and oversized source text', () => {
    assert.throws(() => chunkText('abc', 0), /positive integer/);
    assert.throws(() => chunkText('abcdef', 3, 5), /the limit is 5/);
});
