import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
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
        phase: null, analysisSpec: null, parentId: null, cardNo: null,
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

// ─────────────────────────── 两阶段自动化：约定 skill 自动注入（spec #85）───────────────────────────

describe('WorktreeManager — 约定 skill 注入（真实 git 仓库）', () => {
    let repoDir: string;
    let bundleDir: string;

    beforeEach(() => {
        repoDir = mkdtempSync(path.join(tmpdir(), 'wtmgr-skills-test-'));
        execFileSync('git', ['init', '-q'], { cwd: repoDir });
        execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
        execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
        execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: repoDir });

        // 一份精简的钉版 bundle（只放 2 个 skill，避免依赖真实 skills/dev-workflow-bundle 的具体内容）
        bundleDir = mkdtempSync(path.join(tmpdir(), 'wtmgr-bundle-'));
        mkdirSync(path.join(bundleDir, 'grilling'), { recursive: true });
        writeFileSync(path.join(bundleDir, 'grilling', 'SKILL.md'), '---\nname: grilling\n---\n# Grilling\n');
        mkdirSync(path.join(bundleDir, 'to-spec'), { recursive: true });
        writeFileSync(path.join(bundleDir, 'to-spec', 'SKILL.md'), '---\nname: to-spec\n---\n# To Spec\n');
    });

    afterEach(() => {
        rmSync(repoDir, { recursive: true, force: true });
        rmSync(bundleDir, { recursive: true, force: true });
    });

    it('缺失的约定 skill 从钉版 bundle 复制进 worktree 的 .agents/skills，并写入 info/exclude', async () => {
        const manager = new WorktreeManager(bundleDir);
        const project = fakeProject(repoDir);
        const requirement = fakeRequirement('demo#skills1');

        const info = await manager.ensure(project, requirement);

        expect(existsSync(path.join(info.path, '.agents', 'skills', 'grilling', 'SKILL.md'))).toBe(true);
        expect(existsSync(path.join(info.path, '.agents', 'skills', 'to-spec', 'SKILL.md'))).toBe(true);

        const excludeContent = readFileSync(path.join(repoDir, '.git', 'info', 'exclude'), 'utf-8');
        expect(excludeContent).toContain('.agents/skills/');
    });

    it('仓库已自带同名 skill 时不覆盖仓库版本', async () => {
        const manager = new WorktreeManager(bundleDir);
        const project = fakeProject(repoDir);
        const requirement = fakeRequirement('demo#skills2');
        const worktreePath = worktreePathFor(project, requirement.reqKey);

        // 先手动建 worktree（不经过 manager.ensure，模拟“已存在但没跑过注入”的场景），
        // 并在仓库自带一份不同内容的同名 skill
        execFileSync('git', ['worktree', 'add', worktreePath, '-b', branchNameFor(requirement.reqKey)], { cwd: repoDir });
        mkdirSync(path.join(worktreePath, '.agents', 'skills', 'grilling'), { recursive: true });
        writeFileSync(path.join(worktreePath, '.agents', 'skills', 'grilling', 'SKILL.md'), '仓库自己的版本，不应被覆盖');

        await manager.ensure(project, requirement);

        expect(readFileSync(path.join(worktreePath, '.agents', 'skills', 'grilling', 'SKILL.md'), 'utf-8'))
            .toBe('仓库自己的版本，不应被覆盖');
        // to-spec 仓库没有自带，仍应被注入
        expect(existsSync(path.join(worktreePath, '.agents', 'skills', 'to-spec', 'SKILL.md'))).toBe(true);
    });

    it('重复调用 ensure() 幂等：info/exclude 不会重复追加同一行', async () => {
        const manager = new WorktreeManager(bundleDir);
        const project = fakeProject(repoDir);
        const requirement = fakeRequirement('demo#skills3');

        await manager.ensure(project, requirement); // 首次注入
        await manager.ensure(project, requirement); // 已存在，复用分支——仍应检查一遍（本例已全部注入，不会再写）

        const excludeContent = readFileSync(path.join(repoDir, '.git', 'info', 'exclude'), 'utf-8');
        const occurrences = excludeContent.split('\n').filter(l => l.trim() === '.agents/skills/').length;
        expect(occurrences).toBe(1);
    });

    it('钉版 bundle 里没有的 skill 名不报错，防御性跳过', async () => {
        const manager = new WorktreeManager(bundleDir); // bundle 里没有 to-tickets/implement
        const project = fakeProject(repoDir);
        const requirement = fakeRequirement('demo#skills4');

        const info = await manager.ensure(project, requirement); // 不应抛错
        expect(existsSync(path.join(info.path, '.agents', 'skills', 'to-tickets'))).toBe(false);
    });
});
