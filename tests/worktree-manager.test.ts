import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { WorktreeManager, escapeReqKey, branchNameFor, worktreePathFor } from '../src/core/worktree-manager.js';
import type { Project } from '../src/core/project-repository.js';
import type { Requirement } from '../src/core/requirement-repository.js';

function fakeProject(dir: string): Project {
    return {
        id: 'p1', name: 'demo', dir, description: null, syncSource: 'github', syncConfig: null,
        lastSyncedAt: null, maxConcurrentRuns: 2, skillsInstalledAt: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };
}

function fakeRequirement(reqKey: string): Requirement {
    return {
        id: 'r1', projectId: 'p1', reqKey, source: 'github', sourceKey: '42', title: 'demo requirement',
        description: null, labels: [], status: 'queued', sourceUrl: null, sourceClosed: false,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };
}

describe('escapeReqKey / branchNameFor / worktreePathFor', () => {
    it('escapes # to - and builds the branch/worktree names per spec §4.1/§4.2', () => {
        expect(escapeReqKey('cmasterBot#42')).toBe('cmasterBot-42');
        expect(branchNameFor('cmasterBot#42')).toBe('req/cmasterBot-42');
        expect(worktreePathFor(fakeProject('/repo/cmasterBot'), 'cmasterBot#42'))
            .toBe(path.join('/repo/cmasterBot', '.cmaster', 'worktrees', 'cmasterBot-42'));
    });
});

describe('WorktreeManager (real git repo)', () => {
    let repoDir: string;
    let manager: WorktreeManager;

    beforeEach(() => {
        repoDir = mkdtempSync(path.join(tmpdir(), 'wtmgr-test-'));
        execFileSync('git', ['init', '-q'], { cwd: repoDir });
        execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
        execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
        execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: repoDir });
        manager = new WorktreeManager();
    });

    afterEach(() => {
        rmSync(repoDir, { recursive: true, force: true });
    });

    it('ensure() creates a new worktree + branch req/{escaped-req-key}', async () => {
        const project = fakeProject(repoDir);
        const requirement = fakeRequirement('demo#1');

        const info = await manager.ensure(project, requirement);
        expect(info.branch).toBe('req/demo-1');
        expect(existsSync(info.path)).toBe(true);

        const branches = execFileSync('git', ['branch', '--list', 'req/demo-1'], { cwd: repoDir, encoding: 'utf-8' });
        expect(branches).toContain('req/demo-1');
    });

    it('ensure() reuses an existing worktree instead of recreating it (断点续跑)', async () => {
        const project = fakeProject(repoDir);
        const requirement = fakeRequirement('demo#2');

        const first = await manager.ensure(project, requirement);
        // 在 worktree 里写一个文件，模拟半成品现场
        const { writeFileSync } = await import('fs');
        writeFileSync(path.join(first.path, 'wip.txt'), 'half-done work');

        const second = await manager.ensure(project, requirement);
        expect(second.path).toBe(first.path);
        expect(existsSync(path.join(second.path, 'wip.txt'))).toBe(true);
    });

    it('remove() deletes the worktree directory and local branch', async () => {
        const project = fakeProject(repoDir);
        const requirement = fakeRequirement('demo#3');

        const info = await manager.ensure(project, requirement);
        expect(existsSync(info.path)).toBe(true);

        await manager.remove(project, requirement);
        expect(existsSync(info.path)).toBe(false);
        const branches = execFileSync('git', ['branch', '--list', 'req/demo-3'], { cwd: repoDir, encoding: 'utf-8' });
        expect(branches).not.toContain('req/demo-3');
    });

    it('reset() removes and recreates the worktree (人工重置重来)', async () => {
        const project = fakeProject(repoDir);
        const requirement = fakeRequirement('demo#4');

        const first = await manager.ensure(project, requirement);
        const { writeFileSync } = await import('fs');
        writeFileSync(path.join(first.path, 'wip.txt'), 'half-done work');

        const reset = await manager.reset(project, requirement);
        expect(reset.path).toBe(first.path);
        expect(existsSync(path.join(reset.path, 'wip.txt'))).toBe(false);
    });

    it('exists() reflects worktree presence', async () => {
        const project = fakeProject(repoDir);
        const requirement = fakeRequirement('demo#5');
        expect(manager.exists(project, requirement.reqKey)).toBe(false);
        await manager.ensure(project, requirement);
        expect(manager.exists(project, requirement.reqKey)).toBe(true);
    });

    it('pruneOrphans() removes worktrees not in the keep list', async () => {
        const project = fakeProject(repoDir);
        const keep = fakeRequirement('demo#6');
        const orphan = fakeRequirement('demo#7');

        const keepInfo = await manager.ensure(project, keep);
        const orphanInfo = await manager.ensure(project, orphan);

        const removed = await manager.pruneOrphans(project, [keep.reqKey]);
        expect(removed).toEqual(['demo-7']);
        expect(existsSync(keepInfo.path)).toBe(true);
        expect(existsSync(orphanInfo.path)).toBe(false);
    });
});
