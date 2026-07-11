import path from 'path';
import { existsSync } from 'fs';
import { rm, readdir } from 'fs/promises';
import { spawnCli } from '../skills/utils.js';
import type { Project } from './project-repository.js';
import type { Requirement } from './requirement-repository.js';

export interface WorktreeInfo {
    path: string;
    branch: string;
}

/** req_key 转义为文件系统/分支安全的形式：`#` → `-`（spec §4.1，如 `cmasterBot#42` → `cmasterBot-42`）*/
export function escapeReqKey(reqKey: string): string {
    return reqKey.replace(/#/g, '-');
}

/** 分支命名固定 `req/{req_key 转义}`（spec §4.1）*/
export function branchNameFor(reqKey: string): string {
    return `req/${escapeReqKey(reqKey)}`;
}

/** worktree 物理位置：项目主目录 `.cmaster/worktrees/{req_key转义}/`（spec §4.2）*/
export function worktreePathFor(project: Project, reqKey: string): string {
    return path.join(project.dir, '.cmaster', 'worktrees', escapeReqKey(reqKey));
}

/**
 * 服务端自建 worktree 管理器（spec §4.2）：直接 `git worktree add/remove`，
 * 不复用 Claude Code 的 EnterWorktree（交互式 CLI 工具，运行形态不同）。
 * 1 需求 : 1 活跃 worktree（spec §4.1），不允许并存多个。
 */
export class WorktreeManager {
    /** 已存在则直接复用（断点续跑的半成品与错误现场），否则新建 */
    async ensure(project: Project, requirement: Requirement): Promise<WorktreeInfo> {
        const worktreePath = worktreePathFor(project, requirement.reqKey);
        const branch = branchNameFor(requirement.reqKey);
        if (existsSync(worktreePath)) {
            return { path: worktreePath, branch };
        }
        await spawnCli('git', ['worktree', 'add', worktreePath, '-b', branch], { cwd: project.dir });
        return { path: worktreePath, branch };
    }

    /** 人工"重置重来"：删 worktree + 分支后重建（spec §4.1） */
    async reset(project: Project, requirement: Requirement): Promise<WorktreeInfo> {
        await this.remove(project, requirement, { force: true });
        return this.ensure(project, requirement);
    }

    /** `merged` 自动清理 / `cancelled` 人工确认后清理走这个方法（spec §4.3） */
    async remove(project: Project, requirement: Requirement, opts?: { force?: boolean }): Promise<void> {
        const worktreePath = worktreePathFor(project, requirement.reqKey);
        const branch = branchNameFor(requirement.reqKey);

        if (existsSync(worktreePath)) {
            try {
                await spawnCli(
                    'git',
                    ['worktree', 'remove', worktreePath, ...(opts?.force ? ['--force'] : [])],
                    { cwd: project.dir }
                );
            } catch {
                // worktree 记录可能已损坏（如目录被手动删除），退化为直接删目录 + prune
                await rm(worktreePath, { recursive: true, force: true });
                try { await spawnCli('git', ['worktree', 'prune'], { cwd: project.dir }); } catch { /* best-effort */ }
            }
        }
        try {
            await spawnCli('git', ['branch', '-D', branch], { cwd: project.dir });
        } catch {
            // 分支可能不存在，忽略
        }
    }

    exists(project: Project, reqKey: string): boolean {
        return existsSync(worktreePathFor(project, reqKey));
    }

    /**
     * 兜底：清理孤儿 worktree（需求已删/已终态但目录残留，spec §4.3）。
     * 扫描 `.cmaster/worktrees/` 下不在 `keepReqKeys` 保留名单内的目录并删除。
     */
    async pruneOrphans(project: Project, keepReqKeys: string[]): Promise<string[]> {
        const dir = path.join(project.dir, '.cmaster', 'worktrees');
        if (!existsSync(dir)) return [];

        const keep = new Set(keepReqKeys.map(escapeReqKey));
        const entries = await readdir(dir, { withFileTypes: true });
        const removed: string[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory() || keep.has(entry.name)) continue;
            const worktreePath = path.join(dir, entry.name);
            try {
                await spawnCli('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: project.dir });
            } catch {
                await rm(worktreePath, { recursive: true, force: true });
            }
            removed.push(entry.name);
        }

        if (removed.length > 0) {
            try { await spawnCli('git', ['worktree', 'prune'], { cwd: project.dir }); } catch { /* best-effort */ }
        }
        return removed;
    }
}

export const worktreeManager = new WorktreeManager();
