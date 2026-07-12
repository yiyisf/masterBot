import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { rm, readdir, mkdir, cp, readFile, appendFile } from 'fs/promises';
import { spawnCli } from '../skills/utils.js';
import type { Project } from './project-repository.js';
import type { Requirement } from './requirement-repository.js';

export interface WorktreeInfo {
    path: string;
    branch: string;
}

/**
 * 两阶段自动化绑定的约定 skill 名（spec: 两阶段自动化 #85，地图 #74 ticket #79 决策）：
 * 分析阶段 = grilling+to-spec；拆卡阶段 = to-tickets；单卡实现阶段 = implement。
 */
export const DEV_WORKFLOW_SKILL_NAMES = ['grilling', 'to-spec', 'to-tickets', 'implement'] as const;

/** 平台钉版 skill 副本所在目录（本仓库 skills/dev-workflow-bundle/<name>/SKILL.md） */
const DEFAULT_SKILL_BUNDLE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../skills/dev-workflow-bundle');

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
    constructor(private skillBundleDir: string = DEFAULT_SKILL_BUNDLE_DIR) {}

    /** 已存在则直接复用（断点续跑的半成品与错误现场），否则新建；两种情况都会补齐缺失的约定 skill */
    async ensure(project: Project, requirement: Requirement): Promise<WorktreeInfo> {
        const worktreePath = worktreePathFor(project, requirement.reqKey);
        const branch = branchNameFor(requirement.reqKey);
        if (existsSync(worktreePath)) {
            await this.ensureDevWorkflowSkills(worktreePath);
            return { path: worktreePath, branch };
        }
        await spawnCli('git', ['worktree', 'add', worktreePath, '-b', branch], { cwd: project.dir });
        await this.ensureDevWorkflowSkills(worktreePath);
        return { path: worktreePath, branch };
    }

    /**
     * 两阶段自动化（spec #85）：检查目标仓库 worktree 的 .agents/skills 是否已有约定 skill
     * （grilling/to-spec/to-tickets/implement），缺失则从平台钉版副本复制注入；仓库已自带
     * 同名 skill 时尊重仓库版本，不覆盖。注入的文件不提交进目标仓库（写入 .git/info/exclude）。
     */
    private async ensureDevWorkflowSkills(worktreePath: string): Promise<void> {
        const skillsDir = path.join(worktreePath, '.agents', 'skills');
        let injectedAny = false;
        for (const name of DEV_WORKFLOW_SKILL_NAMES) {
            const target = path.join(skillsDir, name);
            if (existsSync(target)) continue; // 仓库已自带，尊重仓库版本
            const source = path.join(this.skillBundleDir, name);
            if (!existsSync(source)) continue; // 钉版副本缺失（不应发生，防御性跳过而非抛错中断执行）
            await mkdir(path.dirname(target), { recursive: true });
            await cp(source, target, { recursive: true });
            injectedAny = true;
        }
        if (injectedAny) await this.excludeDevWorkflowSkills(worktreePath);
    }

    /**
     * 注入的 skills 不提交进目标仓库：写入 info/exclude（幂等）。worktree 的 `.git` 是指向
     * 主仓库 `.git/worktrees/<name>/` 的文件而非目录，`info/exclude` 是所有 worktree 共享的
     * 公共数据、不在每个 worktree 自己的 gitdir 下——必须用 `git rev-parse --git-common-dir`
     * 取真实公共目录，不能直接拼 `<worktreePath>/.git/info/exclude`（那样会因 .git 是文件而失败）。
     */
    private async excludeDevWorkflowSkills(worktreePath: string): Promise<void> {
        const line = '.agents/skills/';
        try {
            const commonDir = (await spawnCli('git', ['rev-parse', '--git-common-dir'], { cwd: worktreePath })).trim();
            const resolvedCommonDir = path.isAbsolute(commonDir) ? commonDir : path.join(worktreePath, commonDir);
            const excludePath = path.join(resolvedCommonDir, 'info', 'exclude');
            const existing = existsSync(excludePath) ? await readFile(excludePath, 'utf-8') : '';
            if (existing.split('\n').some(l => l.trim() === line)) return; // 已写过
            await mkdir(path.dirname(excludePath), { recursive: true });
            await appendFile(excludePath, `${existing.endsWith('\n') || existing === '' ? '' : '\n'}${line}\n`);
        } catch {
            // 写入失败不应中断执行——注入的 skill 目录仍然生效，只是未被排除跟踪
        }
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
