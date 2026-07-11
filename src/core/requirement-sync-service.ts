import { projectRepository, type ProjectRepository } from './project-repository.js';
import { requirementRepository, type RequirementRepository, type Requirement } from './requirement-repository.js';
import { syncSourceRegistry, type SyncSourceRegistry } from './requirement-sync.js';

export interface SyncProjectResult {
    source: string;
    created: number;
    updated: number;
    closed: number;
    syncedAt: string;
}

export interface CreateManualRequirementInput {
    title: string;
    description?: string;
    labels?: string[];
}

export interface RequirementSyncServiceDeps {
    projects?: ProjectRepository;
    requirements?: RequirementRepository;
    registry?: SyncSourceRegistry;
}

/**
 * 需求同步编排：驱动某个项目走一次同步（拉取 + 落库去重 upsert），
 * 以及手动创建需求。落库规则见 spec §2.2：命中去重键只更元数据，绝不回退状态机。
 */
export class RequirementSyncService {
    private projects: ProjectRepository;
    private requirements: RequirementRepository;
    private registry: SyncSourceRegistry;

    constructor(deps: RequirementSyncServiceDeps = {}) {
        this.projects = deps.projects ?? projectRepository;
        this.requirements = deps.requirements ?? requirementRepository;
        this.registry = deps.registry ?? syncSourceRegistry;
    }

    async syncProject(projectId: string): Promise<SyncProjectResult> {
        const project = this.projects.getById(projectId);
        if (!project) throw new Error(`Project not found: ${projectId}`);

        const source = this.registry.get(project.syncSource);
        if (!source) throw new Error(`Unknown sync source: ${project.syncSource}`);

        const remoteItems = await source.fetchRequirements(project, { since: project.lastSyncedAt ?? undefined });

        let created = 0;
        let updated = 0;
        let closed = 0;

        for (const item of remoteItems) {
            const existing = this.requirements.findByDedupKey(project.id, source.name, item.sourceKey);

            if (!existing) {
                const requirement = this.requirements.create({
                    projectId: project.id,
                    reqKey: `${project.name}#${item.sourceKey}`,
                    source: source.name,
                    sourceKey: item.sourceKey,
                    title: item.title,
                    description: item.description,
                    labels: item.labels,
                    sourceUrl: item.sourceUrl,
                });
                created++;
                if (item.closed) {
                    this.requirements.markSourceClosed(requirement.id);
                    closed++;
                }
                continue;
            }

            this.requirements.updateMetadata(existing.id, {
                title: item.title,
                description: item.description,
                labels: item.labels,
                sourceUrl: item.sourceUrl,
            });
            updated++;
            if (item.closed && !existing.sourceClosed) {
                this.requirements.markSourceClosed(existing.id);
                closed++;
            }
        }

        const syncedAt = new Date().toISOString();
        this.projects.touchSynced(project.id, syncedAt);

        return { source: source.name, created, updated, closed, syncedAt };
    }

    createManualRequirement(projectId: string, input: CreateManualRequirementInput): Requirement {
        const project = this.projects.getById(projectId);
        if (!project) throw new Error(`Project not found: ${projectId}`);

        const seq = this.requirements.nextManualSequence(project.id);
        return this.requirements.create({
            projectId: project.id,
            reqKey: `${project.name}#${seq}`,
            source: 'manual',
            sourceKey: seq,
            title: input.title,
            description: input.description,
            labels: input.labels,
        });
    }
}

export const requirementSyncService = new RequirementSyncService();
