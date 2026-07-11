import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Project } from './project-repository.js';
import type { RequirementSyncSource, RemoteRequirement, SyncOptions } from './requirement-sync.js';

const execFileAsync = promisify(execFile);

const GITHUB_API_BASE = 'https://api.github.com';
const PAGE_SIZE = 100;

export interface RepoInfo {
    owner: string;
    repo: string;
}

interface GitHubIssue {
    number: number;
    title: string;
    body: string | null;
    labels: Array<{ name: string } | string>;
    html_url: string;
    state: 'open' | 'closed';
    pull_request?: unknown;
}

/**
 * 解析 GitHub remote URL，支持 https://github.com/owner/repo(.git) 与
 * git@github.com:owner/repo(.git) 两种形式（纯函数，便于单测）。
 */
export function parseGitHubRemoteUrl(url: string): RepoInfo {
    const match = url.trim().match(/github\.com[:/]+([^/]+)\/([^/.]+?)(\.git)?$/);
    if (!match) {
        throw new Error(`无法从 git remote origin 推断 GitHub owner/repo: ${url}`);
    }
    return { owner: match[1], repo: match[2] };
}

/** 从项目目录的 `git remote origin` 推断 owner/repo（spec §2.5）。 */
export async function inferRepoInfoFromGitRemote(dir: string): Promise<RepoInfo> {
    const { stdout } = await execFileAsync('git', ['-C', dir, 'remote', 'get-url', 'origin']);
    return parseGitHubRemoteUrl(stdout);
}

export interface GitHubSyncSourceDeps {
    /** 依赖注入，便于单测；默认使用全局 fetch */
    fetchImpl?: typeof fetch;
    /** 依赖注入，便于单测；默认读取 project.syncConfig.owner/repo 覆盖，否则从 git remote 推断 */
    resolveRepoInfo?: (project: Project) => Promise<RepoInfo>;
    /** 默认取 process.env.GITHUB_TOKEN；公开仓库可不设置 */
    token?: string;
}

/**
 * 默认 GitHub adapter（spec §2.5）：仅 open issue、排除 PR、可选 label 过滤、
 * last_synced_at 增量水位线（首次全量拉 open，之后 since+state=all 捕获远程关闭）。
 */
export class GitHubSyncSource implements RequirementSyncSource {
    readonly name = 'github';
    private fetchImpl: typeof fetch;
    private resolveRepoInfoImpl: (project: Project) => Promise<RepoInfo>;
    private token?: string;

    constructor(deps: GitHubSyncSourceDeps = {}) {
        this.fetchImpl = deps.fetchImpl ?? fetch;
        this.resolveRepoInfoImpl = deps.resolveRepoInfo ?? ((project) => this.defaultResolveRepoInfo(project));
        this.token = deps.token ?? process.env.GITHUB_TOKEN;
    }

    private async defaultResolveRepoInfo(project: Project): Promise<RepoInfo> {
        const config = project.syncConfig as { owner?: string; repo?: string } | null;
        if (config?.owner && config?.repo) {
            return { owner: config.owner, repo: config.repo };
        }
        return inferRepoInfoFromGitRemote(project.dir);
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
        if (this.token) headers.Authorization = `Bearer ${this.token}`;
        return headers;
    }

    async fetchRequirements(project: Project, options: SyncOptions): Promise<RemoteRequirement[]> {
        const { owner, repo } = await this.resolveRepoInfoImpl(project);
        const baseParams = new URLSearchParams({ per_page: String(PAGE_SIZE) });
        if (options.since) {
            baseParams.set('state', 'all');
            baseParams.set('since', options.since);
        } else {
            baseParams.set('state', 'open');
        }

        const headers = this.buildHeaders();
        const issues = await this.fetchAllPages(owner, repo, baseParams, headers);
        const labelFilter = (project.syncConfig as { labelFilter?: string[] } | null)?.labelFilter;

        return issues
            .filter(issue => !issue.pull_request)
            .filter(issue => {
                if (!labelFilter || labelFilter.length === 0) return true;
                const issueLabels = issue.labels.map(l => (typeof l === 'string' ? l : l.name));
                return issueLabels.some(name => labelFilter.includes(name));
            })
            .map(issue => ({
                sourceKey: String(issue.number),
                title: issue.title,
                description: issue.body ?? undefined,
                labels: issue.labels.map(l => (typeof l === 'string' ? l : l.name)),
                sourceUrl: issue.html_url,
                closed: issue.state === 'closed',
            }));
    }

    async testConnection(project: Project): Promise<boolean> {
        try {
            const { owner, repo } = await this.resolveRepoInfoImpl(project);
            const res = await this.fetchImpl(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, { headers: this.buildHeaders() });
            return res.ok;
        } catch {
            return false;
        }
    }

    private async fetchAllPages(
        owner: string,
        repo: string,
        baseParams: URLSearchParams,
        headers: Record<string, string>
    ): Promise<GitHubIssue[]> {
        const results: GitHubIssue[] = [];
        for (let page = 1; ; page++) {
            const params = new URLSearchParams(baseParams);
            params.set('page', String(page));
            const res = await this.fetchImpl(`${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?${params.toString()}`, { headers });
            if (!res.ok) {
                throw new Error(`GitHub API 请求失败: ${res.status} ${res.statusText}`);
            }
            const batch = await res.json() as GitHubIssue[];
            results.push(...batch);
            if (batch.length < PAGE_SIZE) break;
        }
        return results;
    }
}
