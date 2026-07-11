import { describe, it, expect, beforeEach } from 'vitest';
import { SyncSourceRegistry, type RequirementSyncSource } from '../src/core/requirement-sync.js';

function fakeSource(name: string): RequirementSyncSource {
    return {
        name,
        async fetchRequirements() { return []; },
    };
}

describe('SyncSourceRegistry', () => {
    let registry: SyncSourceRegistry;

    beforeEach(() => {
        registry = new SyncSourceRegistry();
    });

    it('registers and looks up a source by name', () => {
        const source = fakeSource('github');
        registry.register(source);
        expect(registry.get('github')).toBe(source);
    });

    it('returns undefined for an unregistered source', () => {
        expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('lists registered source names', () => {
        registry.register(fakeSource('github'));
        registry.register(fakeSource('gitlab'));
        expect(registry.list().sort()).toEqual(['github', 'gitlab']);
    });

    it('unregisters a source', () => {
        registry.register(fakeSource('github'));
        registry.unregister('github');
        expect(registry.get('github')).toBeUndefined();
    });

    it('overwrites a source registered under the same name', () => {
        const first = fakeSource('github');
        const second = fakeSource('github');
        registry.register(first);
        registry.register(second);
        expect(registry.get('github')).toBe(second);
    });
});
