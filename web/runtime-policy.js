export const MODEL_DOWNLOAD_MIB = 380;
export const MAX_READER_CHARACTERS = 20_000;
export const MAX_PREVIEW_CHARACTERS = 2_000;
export const MAX_TEXT_FILE_BYTES = 256 * 1024;
export const MAX_CUSTOM_VOICE_FILE_BYTES = 1024 * 1024;

export const VOICE_TENSOR_SPECS = Object.freeze({
    style_ttl: Object.freeze([1, 50, 256]),
    style_dp: Object.freeze([1, 8, 16]),
});

function graphemeSegments(text) {
    if (typeof Intl?.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        return Array.from(segmenter.segment(text), ({ segment }) => segment);
    }

    // Array.from keeps Unicode code points intact in older browsers, even when
    // full grapheme segmentation is unavailable.
    return Array.from(text);
}

export function unicodeCharacters(text) {
    if (typeof text !== 'string') {
        throw new TypeError(`Expected text to be a string, got ${typeof text}.`);
    }
    return graphemeSegments(text);
}

export function unicodeLength(text) {
    return unicodeCharacters(text).length;
}

export function splitUnicode(text, maxLength) {
    if (!Number.isSafeInteger(maxLength) || maxLength < 1) {
        throw new RangeError('Maximum chunk length must be a positive integer.');
    }

    const characters = unicodeCharacters(text);
    const chunks = [];
    for (let index = 0; index < characters.length; index += maxLength) {
        chunks.push(characters.slice(index, index + maxLength).join(''));
    }
    return chunks;
}

export function assertTextWithinLimit(
    text,
    maxLength = MAX_READER_CHARACTERS,
    label = 'Source text'
) {
    const length = unicodeLength(text);
    if (length > maxLength) {
        throw new RangeError(`${label} is ${length.toLocaleString()} characters; the limit is ${maxLength.toLocaleString()}.`);
    }
    return length;
}

export function assertFileWithinLimit(file, maxBytes, label) {
    if (!file || !Number.isFinite(file.size) || file.size < 0) {
        throw new TypeError(`${label} is not a valid file.`);
    }
    if (file.size > maxBytes) {
        const limitKiB = Math.floor(maxBytes / 1024);
        throw new RangeError(`${label} is too large; the limit is ${limitKiB.toLocaleString()} KiB.`);
    }
}

function assertExactDimensions(actual, expected, name) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
        throw new TypeError(`${name}.dims must be [${expected.join(', ')}].`);
    }
    for (let index = 0; index < expected.length; index += 1) {
        if (actual[index] !== expected[index]) {
            throw new TypeError(`${name}.dims must be [${expected.join(', ')}].`);
        }
    }
}

function flattenExactTensorData(value, dimensions, name, depth = 0, output = []) {
    if (depth === dimensions.length) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new TypeError(`${name}.data must contain only finite numbers.`);
        }
        output.push(value);
        return output;
    }

    const expectedLength = dimensions[depth];
    if (!Array.isArray(value) || value.length !== expectedLength) {
        throw new TypeError(`${name}.data does not match dimensions [${dimensions.join(', ')}].`);
    }

    for (const child of value) {
        flattenExactTensorData(child, dimensions, name, depth + 1, output);
    }
    return output;
}

export function validateVoiceTensor(tensor, expectedDimensions, name) {
    if (!tensor || typeof tensor !== 'object' || Array.isArray(tensor)) {
        throw new TypeError(`${name} must be a tensor object.`);
    }
    if (tensor.type !== 'float32') {
        throw new TypeError(`${name}.type must be "float32".`);
    }
    assertExactDimensions(tensor.dims, expectedDimensions, name);
    const data = flattenExactTensorData(tensor.data, expectedDimensions, name);
    const expectedValues = expectedDimensions.reduce((product, size) => product * size, 1);
    if (data.length !== expectedValues) {
        throw new TypeError(`${name}.data must contain exactly ${expectedValues.toLocaleString()} values.`);
    }
    return data;
}

export function validateVoiceStyleObject(voiceStyle) {
    if (!voiceStyle || typeof voiceStyle !== 'object' || Array.isArray(voiceStyle)) {
        throw new TypeError('Custom voice JSON must be a Supertonic voice-style object.');
    }

    const tensors = {};
    for (const [name, dimensions] of Object.entries(VOICE_TENSOR_SPECS)) {
        tensors[name] = validateVoiceTensor(voiceStyle[name], dimensions, name);
    }
    return tensors;
}

export function dataSaverEnabled(connection = globalThis.navigator?.connection) {
    return connection?.saveData === true;
}
