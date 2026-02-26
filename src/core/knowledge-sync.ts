import type { Logger } from '../types.js';
import type { KnowledgeGraph } from '../memory/knowledge-graph.js';

export interface KnowledgeSyncSource {
    name: string;
    /** Fetch updated items since a given timestamp */
    listUpdated(since: string): Promise<Array<{ id: string; title: string; updatedAt: string }>>;
    /** Fetch full content of an item */
    getContent(id: string): Promise<{ title: string; content: string; source?: string }>;
}

export interface SyncResult {
    source: string;
    created: number;
    updated: number;
    errors: number;
    syncedAt: string;
}

/**
 * Knowledge Sync Service
 * Handles incremental synchronization from external knowledge sources
 * into the knowledge graph. Supports both Cron and Webhook triggers.
 */
export class KnowledgeSyncService {
    private sources: Map<string, KnowledgeSyncSource> = new Map();
    private knowledgeGraph: KnowledgeGraph;
    private logger: Logger;
    private lastSyncTimes: Map<string, string> = new Map();

    constructor(knowledgeGraph: KnowledgeGraph, logger: Logger) {
        this.knowledgeGraph = knowledgeGraph;
        this.logger = logger;
    }

    registerSource(source: KnowledgeSyncSource): void {
        this.sources.set(source.name, source);
        this.logger.info(`[knowledge-sync] Registered source: ${source.name}`);
    }

    /**
     * Sync all registered sources incrementally
     */
    async syncAll(): Promise<SyncResult[]> {
        const results: SyncResult[] = [];

        for (const [name, source] of this.sources) {
            results.push(await this.syncSource(name, source));
        }

        return results;
    }

    /**
     * Sync a specific source by name
     */
    async syncOne(sourceName: string): Promise<SyncResult> {
        const source = this.sources.get(sourceName);
        if (!source) {
            throw new Error(`Unknown sync source: ${sourceName}`);
        }
        return this.syncSource(sourceName, source);
    }

    private async syncSource(name: string, source: KnowledgeSyncSource): Promise<SyncResult> {
        const since = this.lastSyncTimes.get(name) || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const syncedAt = new Date().toISOString();

        this.logger.info(`[knowledge-sync] Syncing source "${name}" since ${since}`);

        let created = 0;
        let updated = 0;
        let errors = 0;

        try {
            const items = await source.listUpdated(since);
            this.logger.info(`[knowledge-sync] Found ${items.length} updated items in "${name}"`);

            for (const item of items) {
                try {
                    const content = await source.getContent(item.id);
                    const result = await this.knowledgeGraph.incrementalIngest(
                        content.content,
                        {
                            title: content.title || item.title,
                            type: 'document',
                            source: content.source || name,
                            delta: true,
                        }
                    );

                    if (result.action === 'created') created++;
                    else updated++;
                } catch (err) {
                    this.logger.error(`[knowledge-sync] Failed to ingest "${item.title}": ${(err as Error).message}`);
                    errors++;
                }
            }

            this.lastSyncTimes.set(name, syncedAt);
        } catch (err) {
            this.logger.error(`[knowledge-sync] Source "${name}" sync failed: ${(err as Error).message}`);
            errors++;
        }

        const result: SyncResult = { source: name, created, updated, errors, syncedAt };
        this.logger.info(`[knowledge-sync] Source "${name}": created=${created} updated=${updated} errors=${errors}`);

        return result;
    }

    /**
     * Handle a Webhook-triggered sync for a specific item
     */
    async syncItem(sourceName: string, itemId: string): Promise<{ action: 'created' | 'updated'; id: string }> {
        const source = this.sources.get(sourceName);
        if (!source) {
            throw new Error(`Unknown sync source: ${sourceName}`);
        }

        const content = await source.getContent(itemId);
        return this.knowledgeGraph.incrementalIngest(content.content, {
            title: content.title,
            type: 'document',
            source: content.source || sourceName,
            delta: true,
        });
    }

    listSources(): string[] {
        return Array.from(this.sources.keys());
    }

    getLastSyncTime(sourceName: string): string | undefined {
        return this.lastSyncTimes.get(sourceName);
    }
}
