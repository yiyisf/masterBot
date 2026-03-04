import { describe, it, expect, beforeEach } from 'vitest';
import { registerSecret, redact, deepRedact, clearSecrets } from '../src/utils/secret-ref.js';

describe('SecretRef Credential Masking', () => {
    beforeEach(() => {
        clearSecrets();
    });

    it('registers a secret and redacts it from string', () => {
        const secret = 'sk-prod-1234567890abcdef';
        const ref = registerSecret(secret);

        expect(ref).toMatch(/^\[SECRET:[\w-]+\]$/);

        const logMsg = `User called API with key ${secret} successfully.`;
        const redactedMsg = redact(logMsg);

        expect(redactedMsg).not.toContain(secret);
        expect(redactedMsg).toContain('[REDACTED]');
        expect(redactedMsg).toBe('User called API with key [REDACTED] successfully.');
    });

    it('handles multiple occurrences of the same secret', () => {
        const secret = 'super-secret-password';
        registerSecret(secret);

        const logMsg = `Password: ${secret}. Yes, it is ${secret}!`;
        const redactedMsg = redact(logMsg);

        expect(redactedMsg).toBe('Password: [REDACTED]. Yes, it is [REDACTED]!');
    });

    it('handles multiple different secrets', () => {
        registerSecret('key-A');
        registerSecret('key-B');

        const result = redact('Used key-A and key-B together');
        expect(result).toBe('Used [REDACTED] and [REDACTED] together');
    });

    it('does not alter string if secret is not present', () => {
        registerSecret('my-secret');
        const normalString = 'Just a normal log message';
        expect(redact(normalString)).toBe(normalString);
    });

    describe('deepRedact', () => {
        it('deeply redacts objects and arrays', () => {
            const apiToken = 'xoxb-123-token';
            const dbPassword = 'db-pass-words';

            registerSecret(apiToken);
            registerSecret(dbPassword);

            const rawResult = {
                status: 'success',
                message: `Connected using token ${apiToken}`,
                credentials: {
                    user: 'admin',
                    password: dbPassword
                },
                history: [
                    `Tried ${dbPassword} previously`,
                    { fallback: apiToken }
                ]
            };

            const redacted = deepRedact(rawResult) as any;

            // Check top level string
            expect(redacted.message).toBe('Connected using token [REDACTED]');
            // Check nested object
            expect(redacted.credentials.password).toBe('[REDACTED]');
            // Check nested array of strings
            expect(redacted.history[0]).toBe('Tried [REDACTED] previously');
            // Check deep nested object in array
            expect(redacted.history[1].fallback).toBe('[REDACTED]');

            // Verify originals are not present
            const jsonStr = JSON.stringify(redacted);
            expect(jsonStr).not.toContain(apiToken);
            expect(jsonStr).not.toContain(dbPassword);
        });

        it('handles null, undefined, and non-string primitives', () => {
            expect(deepRedact(null)).toBe(null);
            expect(deepRedact(undefined)).toBe(undefined);
            expect(deepRedact(42)).toBe(42);
            expect(deepRedact(true)).toBe(true);
        });
    });
});
