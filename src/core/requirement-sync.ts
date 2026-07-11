import type { Project } from './project-repository.js';

/**
 * 从外部渠道拉取到的一条原始需求，字段已归一化为渠道无关的形状；
 * 落库前由同步编排层（requirement-sync-service.ts）转换为 requirements 表行。
 */
export interface RemoteRequirement {
    /** 渠道内原始标识（如 GitHub issue number 的字符串形式），对应 requirements.source_key */
    sourceKey: string;
    title: string;
    description?: string;
    labels: string[];
    sourceUrl?: string;
    /** 远程条目是否已关闭（用于打 source_closed 标记，不驱动状态机，spec §2.2） */
    closed: boolean;
}

export interface SyncOptions {
    /** 增量水位线（对应 projects.last_synced_at）；不传表示首次全量同步 */
    since?: string;
}

/**
 * 需求同步适配器接口。仿 SkillSource/SkillRegistry 的多源模式（src/skills/registry.ts），
 * 走代码接口注册而非 YAML 声明式——同步逻辑本质是代码（spec §2.4）。
 */
export interface RequirementSyncSource {
    readonly name: string;
    fetchRequirements(project: Project, options: SyncOptions): Promise<RemoteRequirement[]>;
    testConnection?(project: Project): Promise<boolean>;
}

/**
 * 同步源注册中心。结构参照 src/core/knowledge-sync.ts 的 KnowledgeSyncService，
 * 但这里只负责持有/查找 source，实际的落库编排在 requirement-sync-service.ts。
 */
export class SyncSourceRegistry {
    private sources: Map<string, RequirementSyncSource> = new Map();

    register(source: RequirementSyncSource): void {
        this.sources.set(source.name, source);
    }

    unregister(name: string): void {
        this.sources.delete(name);
    }

    get(name: string): RequirementSyncSource | undefined {
        return this.sources.get(name);
    }

    list(): string[] {
        return Array.from(this.sources.keys());
    }
}

export const syncSourceRegistry = new SyncSourceRegistry();
