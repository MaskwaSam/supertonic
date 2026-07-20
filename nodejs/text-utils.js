/** Pure, model-free text chunking and CLI validation helpers. */

export const AVAILABLE_LANGS = [
    'en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es',
    'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv',
    'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'
];

export const LIMITS = Object.freeze({
    totalStep: [1, 100],
    speed: [0.25, 4.0],
    nTest: [1, 100],
    maxTextCodepoints: 100_000
});

const ABBREVIATIONS = new Set([
    'Dr.', 'Mr.', 'Mrs.', 'Ms.', 'Prof.', 'Sr.', 'Jr.', 'St.',
    'Ave.', 'Rd.', 'Blvd.', 'Dept.', 'Inc.', 'Ltd.', 'Co.',
    'Corp.', 'etc.', 'vs.', 'i.e.', 'e.g.', 'Ph.D.'
]);

const scalarLength = value => Array.from(value).length;

function isAbbreviation(prefix) {
    const parts = prefix.trimEnd().split(/\s+/);
    const token = parts.at(-1) ?? '';
    return ABBREVIATIONS.has(token) || /^[A-Z]\.$/.test(token);
}

function splitSentences(text) {
    const sentences = [];
    const boundary = /[.!?](?=\s|$)/gu;
    let start = 0;
    let match;
    while ((match = boundary.exec(text)) !== null) {
        const end = match.index + match[0].length;
        if (match[0] === '.' && isAbbreviation(text.slice(start, end))) continue;
        const sentence = text.slice(start, end).trim();
        if (sentence) sentences.push(sentence);
        const whitespace = text.slice(end).match(/^\s*/u)?.[0].length ?? 0;
        start = end + whitespace;
        boundary.lastIndex = start;
    }
    const tail = text.slice(start).trim();
    if (tail) sentences.push(tail);
    return sentences;
}

function hardWrap(text, maxLen) {
    const chunks = [];
    let current = '';
    for (let word of text.split(/\s+/u)) {
        let scalars = Array.from(word);
        while (scalars.length > maxLen) {
            if (current) {
                chunks.push(current);
                current = '';
            }
            chunks.push(scalars.slice(0, maxLen).join(''));
            scalars = scalars.slice(maxLen);
        }
        word = scalars.join('');
        if (!word) continue;
        const candidate = current ? `${current} ${word}` : word;
        if (scalarLength(candidate) <= maxLen) current = candidate;
        else {
            chunks.push(current);
            current = word;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

export function chunkText(text, maxLen = 300) {
    if (typeof text !== 'string') throw new TypeError(`chunkText expects a string, got ${typeof text}`);
    if (!Number.isInteger(maxLen) || maxLen <= 0) throw new RangeError('maxLen must be a positive integer');
    text = text.trim();
    if (!text) return [];

    const chunks = [];
    for (const rawParagraph of text.split(/\n\s*\n+/u)) {
        const paragraph = rawParagraph.trim();
        if (!paragraph) continue;
        let current = '';
        for (const sentence of splitSentences(paragraph)) {
            if (scalarLength(sentence) > maxLen) {
                if (current) chunks.push(current);
                current = '';
                chunks.push(...hardWrap(sentence, maxLen));
                continue;
            }
            const candidate = current ? `${current} ${sentence}` : sentence;
            if (scalarLength(candidate) <= maxLen) current = candidate;
            else {
                chunks.push(current);
                current = sentence;
            }
        }
        if (current) chunks.push(current);
    }
    return chunks;
}

export function validateCliInputs({ totalStep, speed, nTest, text, lang }) {
    if (!Number.isInteger(totalStep) || totalStep < LIMITS.totalStep[0] || totalStep > LIMITS.totalStep[1]) {
        throw new RangeError(`--total-step must be an integer between ${LIMITS.totalStep.join(' and ')}`);
    }
    if (!Number.isFinite(speed) || speed < LIMITS.speed[0] || speed > LIMITS.speed[1]) {
        throw new RangeError(`--speed must be finite and between ${LIMITS.speed.join(' and ')}`);
    }
    if (!Number.isInteger(nTest) || nTest < LIMITS.nTest[0] || nTest > LIMITS.nTest[1]) {
        throw new RangeError(`--n-test must be an integer between ${LIMITS.nTest.join(' and ')}`);
    }
    if (!Array.isArray(text) || text.length === 0) throw new Error('at least one --text value is required');
    for (const value of text) {
        if (typeof value !== 'string' || !value.trim()) throw new Error('--text values must not be blank');
        if (scalarLength(value) > LIMITS.maxTextCodepoints) {
            throw new RangeError(`--text values must not exceed ${LIMITS.maxTextCodepoints} Unicode scalar values`);
        }
    }
    if (!Array.isArray(lang) || lang.length === 0) throw new Error('at least one --lang value is required');
    const invalid = lang.filter(value => !AVAILABLE_LANGS.includes(value));
    if (invalid.length) throw new Error(`unsupported language code(s): ${invalid.join(', ')}`);
}
