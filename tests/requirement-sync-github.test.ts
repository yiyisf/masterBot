import { describe, it, expect, vi } from 'vitest';
import { GitHubSyncSource, parseGitHubRemoteUrl } from '../src/core/requirement-sync-github.js';
import type { Project } from '../src/core/project-repository.js';

function fakeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 'p1',
        name: 'cmasterBot',
        dir: '/repo/cmasterBot',
        description: null,
        syncSource: 'github',
        syncConfig: null,
        lastSyncedAt: null,
        maxConcurrentRuns: 2,
        skillsInstalledAt: null,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        ...overrides,
    };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
    return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response;
}

describe('parseGitHubRemoteUrl', () => {
    it('parses https remote urls', () => {
        expect(parseGitHubRemoteUrl('https://github.com/yiyisf/masterBot.git')).toEqual({ owner: 'yiyisf', repo: 'masterBot' });
        expect(parseGitHubRemoteUrl('https://github.com/yiyisf/masterBot')).toEqual({ owner: 'yiyisf', repo: 'masterBot' });
    });

    it('parses ssh remote urls', () => {
        expect(parseGitHubRemoteUrl('git@github.com:yiyisf/masterBot.git')).toEqual({ owner: 'yiyisf', repo: 'masterBot' });
    });

    it('throws for a non-GitHub url', () => {
        expect(() => parseGitHubRemoteUrl('https://gitlab.com/x/y.git')).toThrow();
    });
});

describe('GitHubSyncSource', () => {
    const resolveRepoInfo = async () => ({ owner: 'yiyisf', repo: 'masterBot' });

    it('excludes pull requests and maps fields', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([
            { number: 1, title: 'Bug A', body: 'desc', labels: [{ name: 'bug' }], html_url: 'https://x/1', state: 'open' },
            { number: 2, title: 'A PR', body: null, labels: [], html_url: 'https://x/2', state: 'open', pull_request: {} },
        ]));
        const source = new GitHubSyncSource({ fetchImpl: fetchImpl as any, resolveRepoInfo });

        const items = await source.fetchRequirements(fakeProject(), {});
        expect(items).toHaveLength(1);
        expect(items[0]).toEqual({
            sourceKey: '1',
            title: 'Bug A',
            description: 'desc',
            labels: ['bug'],
            sourceUrl: 'https://x/1',
            closed: false,
        });
    });

    it('uses state=open on first sync (no since) and state=all+since on incremental sync', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
        const source = new GitHubSyncSource({ fetchImpl: fetchImpl as any, resolveRepoInfo });

        await source.fetchRequirements(fakeProject(), {});
        let url = new URL(fetchImpl.mock.calls[0][0]);
        expect(url.searchParams.get('state')).toBe('open');
        expect(url.searchParams.has('since')).toBe(false);

        fetchImpl.mockClear();
        await source.fetchRequirements(fakeProject(), { since: '2026-07-01T00:00:00Z' });
        url = new URL(fetchImpl.mock.calls[0][0]);
        expect(url.searchParams.get('state')).toBe('all');
        expect(url.searchParams.get('since')).toBe('2026-07-01T00:00:00Z');
    });

    it('filters by project-level label filter when configured', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([
            { number: 1, title: 'A', body: null, labels: [{ name: 'bug' }], html_url: 'https://x/1', state: 'open' },
            { number: 2, title: 'B', body: null, labels: [{ name: 'chore' }], html_url: 'https://x/2', state: 'open' },
        ]));
        const source = new GitHubSyncSource({ fetchImpl: fetchImpl as any, resolveRepoInfo });

        const items = await source.fetchRequirements(fakeProject({ syncConfig: { labelFilter: ['bug'] } }), {});
        expect(items.map(i => i.sourceKey)).toEqual(['1']);
    });

    it('marks closed remote items', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([
            { number: 1, title: 'A', body: null, labels: [], html_url: 'https://x/1', state: 'closed' },
        ]));
        const source = new GitHubSyncSource({ fetchImpl: fetchImpl as any, resolveRepoInfo });

        const items = await source.fetchRequirements(fakeProject(), { since: '2026-01-01' });
        expect(items[0].closed).toBe(true);
    });

    it('paginates when a full page is returned', async () => {
        const fullPage = Array.from({ length: 100 }, (_, i) => ({
            number: i + 1, title: `T${i}`, body: null, labels: [], html_url: 'https://x', state: 'open',
        }));
        const secondPage = [{ number: 101, title: 'Last', body: null, labels: [], html_url: 'https://x/101', state: 'open' }];
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse(fullPage))
            .mockResolvedValueOnce(jsonResponse(secondPage));
        const source = new GitHubSyncSource({ fetchImpl: fetchImpl as any, resolveRepoInfo });

        const items = await source.fetchRequirements(fakeProject(), {});
        expect(items).toHaveLength(101);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('throws when the GitHub API responds with an error status', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 403));
        const source = new GitHubSyncSource({ fetchImpl: fetchImpl as any, resolveRepoInfo });
        await expect(source.fetchRequirements(fakeProject(), {})).rejects.toThrow(/403/);
    });

    it('testConnection reflects the response ok status', async () => {
        const okFetch = vi.fn().mockResolvedValue(jsonResponse({}, true));
        const okSource = new GitHubSyncSource({ fetchImpl: okFetch as any, resolveRepoInfo });
        expect(await okSource.testConnection(fakeProject())).toBe(true);

        const failFetch = vi.fn().mockRejectedValue(new Error('network error'));
        const failSource = new GitHubSyncSource({ fetchImpl: failFetch as any, resolveRepoInfo });
        expect(await failSource.testConnection(fakeProject())).toBe(false);
    });
});
