export const REQUIRED_RUNTIME_MODEL_PATHS = Object.freeze([
    'onnx/tts.json',
    'onnx/unicode_indexer.json',
    'onnx/duration_predictor.onnx',
    'onnx/text_encoder.onnx',
    'onnx/vector_estimator.onnx',
    'onnx/vocoder.onnx',
]);

export class AssetIntegrityError extends Error {
    constructor(message, options = undefined) {
        super(message, options);
        this.name = 'AssetIntegrityError';
    }
}

export function isAssetIntegrityError(error) {
    return error?.name === 'AssetIntegrityError';
}

function assertSafePath(value) {
    return typeof value === 'string' &&
        value.length > 0 &&
        !value.startsWith('/') &&
        !value.includes('..') &&
        !value.includes('\\');
}

export function validateIntegrityManifest(manifest, {
    expectedRevision = '',
    requiredPaths = [],
    exactPaths = false,
} = {}) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('Asset integrity manifest must be an object.');
    }
    if (!/^[0-9a-f]{40}$/.test(String(manifest.revision || ''))) {
        throw new Error('Asset integrity manifest revision must be a full Git commit.');
    }
    if (expectedRevision && manifest.revision !== expectedRevision) {
        throw new Error(`Asset integrity manifest revision ${manifest.revision} does not match ${expectedRevision}.`);
    }
    if (!Array.isArray(manifest.files)) {
        throw new Error('Asset integrity manifest must contain a files array.');
    }

    const entries = new Map();
    for (const entry of manifest.files) {
        if (!entry || typeof entry !== 'object' || !assertSafePath(entry.path)) {
            throw new Error('Asset integrity manifest contains an invalid path.');
        }
        if (entries.has(entry.path)) {
            throw new Error(`Asset integrity manifest contains duplicate path ${entry.path}.`);
        }
        if (!Number.isSafeInteger(entry.size) || entry.size < 1) {
            throw new Error(`Asset integrity manifest contains an invalid size for ${entry.path}.`);
        }
        if (!/^[0-9a-f]{64}$/.test(String(entry.sha256 || ''))) {
            throw new Error(`Asset integrity manifest contains an invalid SHA-256 for ${entry.path}.`);
        }
        entries.set(entry.path, Object.freeze({
            path: entry.path,
            size: entry.size,
            sha256: entry.sha256,
        }));
    }

    const required = [...new Set(requiredPaths)].sort();
    const missing = required.filter((relativePath) => !entries.has(relativePath));
    if (missing.length) {
        throw new Error(`Asset integrity manifest is missing required files: ${missing.join(', ')}.`);
    }
    if (exactPaths) {
        const actual = [...entries.keys()].sort();
        if (JSON.stringify(actual) !== JSON.stringify(required)) {
            const unexpected = actual.filter((relativePath) => !required.includes(relativePath));
            throw new Error(`Asset integrity manifest file set differs from the release allowlist${unexpected.length ? `; unexpected: ${unexpected.join(', ')}` : ''}.`);
        }
    }

    return Object.freeze({
        source: String(manifest.source || ''),
        revision: manifest.revision,
        entries,
    });
}

function asBytes(value) {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError('Integrity verification requires an ArrayBuffer or typed array.');
}

function digestHex(digest) {
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyAssetBytes(value, entry, label = entry?.path || 'asset', subtle = globalThis.crypto?.subtle) {
    if (!entry || !Number.isSafeInteger(entry.size) || !/^[0-9a-f]{64}$/.test(String(entry.sha256 || ''))) {
        throw new AssetIntegrityError(`Missing valid integrity metadata for ${label}.`);
    }
    const bytes = asBytes(value);
    if (bytes.byteLength !== entry.size) {
        throw new AssetIntegrityError(`Integrity check failed for ${label}: expected ${entry.size} bytes, received ${bytes.byteLength}.`);
    }
    if (!subtle?.digest) {
        throw new AssetIntegrityError(`Cannot verify ${label}: Web Crypto SHA-256 is unavailable. Serve the reader over HTTPS.`);
    }
    const actualSha256 = digestHex(await subtle.digest('SHA-256', bytes));
    if (actualSha256 !== entry.sha256) {
        throw new AssetIntegrityError(`Integrity check failed for ${label}: SHA-256 does not match the pinned release manifest.`);
    }
    return bytes;
}
