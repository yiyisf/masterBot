import { nanoid } from 'nanoid';

const registry = new Map<string, string>(); // ref -> plaintext

/**
 * Registers a secret and returns a protected reference string.
 * This reference can be passed around and later redacted from logs/outputs.
 */
export function registerSecret(plaintext: string): string {
    if (!plaintext || typeof plaintext !== 'string') return plaintext;

    // Attempt to find if we already registered this exact secret to avoid duplicates
    for (const [existingRef, pt] of registry.entries()) {
        if (pt === plaintext) return existingRef;
    }

    const ref = `[SECRET:${nanoid(8)}]`;
    registry.set(ref, plaintext);
    return ref;
}

/**
 * Sweeps a given text string and replaces any known plaintexts with [REDACTED].
 * Use this before sending text to LLMs, logs, or UI streams.
 */
export function redact(text: string): string {
    if (!text || typeof text !== 'string') return text;
    if (registry.size === 0) return text;

    let scrubbed = text;
    for (const plaintext of registry.values()) {
        // Simple string replacement across the entire text
        // Note: split/join is fast for sweeping all occurrences
        scrubbed = scrubbed.split(plaintext).join('[REDACTED]');
    }
    return scrubbed;
}

/**
 * Deep sweeps objects, arrays, and strings, replacing plaintexts with [REDACTED].
 */
export function deepRedact(obj: unknown): unknown {
    if (!obj) return obj;
    if (registry.size === 0) return obj;

    if (typeof obj === 'string') {
        return redact(obj);
    }

    if (Array.isArray(obj)) {
        return obj.map(item => deepRedact(item));
    }

    // Check if it is a plain object
    if (typeof obj === 'object') {
        const redactedObj: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            redactedObj[key] = deepRedact(value);
        }
        return redactedObj;
    }

    return obj;
}

/**
 * Clears the registry (useful for testing or reset)
 */
export function clearSecrets(): void {
    registry.clear();
}
