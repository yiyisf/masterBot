import { nanoid } from 'nanoid';
import { db } from '../core/database.js';
import type { LLMAdapter, Logger } from '../types.js';

export interface KnowledgeNode {
    id: string;
    type: string;          // 'document' | 'concept' | 'entity' | 'process'
    title: string;
    content: string;
    metadata: Record<string, unknown>;
    embedding?: number[];
    createdAt: string;
    updatedAt: string;
}

export interface KnowledgeEdge {
    id: string;
    fromId: string;
    toId: string;
    relation: string;    // 'references', 'depends_on', 'part_of', 'related_to'
    weight: number;
    createdAt: string;
}

export interface GraphSearchResult {
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
    relevanceScores: Record<string, number>;
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

export class KnowledgeGraph {
    private llm: LLMAdapter;
    private logger: Logger;

    constructor(llm: LLMAdapter, logger: Logger) {
        this.llm = llm;
        this.logger = logger;
    }

    /**
     * Ingest a document: chunk -> embed -> extract entities -> build graph
     */
    async ingest(content: string, metadata: { title: string; type?: string; source?: string }): Promise<string> {
        this.logger.info(`[knowledge-graph] Ingesting: ${metadata.title}`);

        // Create main document node
        const docId = await this.createNode({
            type: metadata.type || 'document',
            title: metadata.title,
            content: content.substring(0, 2000),
            metadata: { source: metadata.source, fullLength: content.length },
        });

        // Chunk long content and create sub-nodes
        const chunks = this.chunkText(content, 500);
        if (chunks.length > 1) {
            for (let i = 0; i < Math.min(chunks.length, 10); i++) {
                const chunkId = await this.createNode({
                    type: 'chunk',
                    title: `${metadata.title} (Part ${i + 1})`,
                    content: chunks[i],
                    metadata: { parentId: docId, chunkIndex: i },
                });
                this.createEdge(docId, chunkId, 'contains', 1.0);
            }
        }

        // Extract entities via LLM
        try {
            await this.extractAndLinkEntities(docId, content.substring(0, 1500));
        } catch (err) {
            this.logger.warn(`[knowledge-graph] Entity extraction failed: ${(err as Error).message}`);
        }

        return docId;
    }

    /**
     * Vector + graph search: find relevant nodes, traverse neighbors
     */
    async search(query: string, opts?: { depth?: number; limit?: number }): Promise<GraphSearchResult> {
        const { depth = 2, limit = 10 } = opts || {};

        // Get query embedding
        let queryEmbedding: number[] | null = null;
        try {
            const embeddings = await this.llm.embeddings([query]);
            queryEmbedding = embeddings[0];
        } catch {
            // Fall through to text search
        }

        // Find seed nodes by vector similarity or text search
        const allNodes = this.getAllNodes();
        let seedNodes: Array<{ node: KnowledgeNode; score: number }> = [];

        if (queryEmbedding) {
            for (const node of allNodes) {
                if (node.embedding) {
                    const emb = JSON.parse(node.embedding as unknown as string) as number[];
                    const score = cosineSimilarity(queryEmbedding, emb);
                    if (score > 0.5) seedNodes.push({ node, score });
                }
            }
            seedNodes.sort((a, b) => b.score - a.score);
        }

        // Fallback to text search
        if (seedNodes.length === 0) {
            const keywords = query.toLowerCase().split(/\s+/);
            for (const node of allNodes) {
                const text = (node.title + ' ' + node.content).toLowerCase();
                const matches = keywords.filter(k => text.includes(k)).length;
                if (matches > 0) seedNodes.push({ node, score: matches / keywords.length });
            }
            seedNodes.sort((a, b) => b.score - a.score);
        }

        const topSeeds = seedNodes.slice(0, 5);
        const visitedIds = new Set<string>();
        const resultNodes: KnowledgeNode[] = [];
        const resultEdges: KnowledgeEdge[] = [];
        const scores: Record<string, number> = {};

        // BFS graph traversal from seed nodes
        const queue: Array<{ id: string; score: number; remainingDepth: number }> =
            topSeeds.map(s => ({ id: s.node.id, score: s.score, remainingDepth: depth }));

        while (queue.length > 0 && resultNodes.length < limit) {
            const { id, score, remainingDepth } = queue.shift()!;
            if (visitedIds.has(id)) continue;
            visitedIds.add(id);

            const node = this.getNode(id);
            if (!node) continue;
            resultNodes.push(node);
            scores[id] = score;

            if (remainingDepth > 0) {
                const edges = this.getEdges(id);
                for (const edge of edges) {
                    resultEdges.push(edge);
                    const neighborId = edge.fromId === id ? edge.toId : edge.fromId;
                    if (!visitedIds.has(neighborId)) {
                        queue.push({ id: neighborId, score: score * edge.weight * 0.7, remainingDepth: remainingDepth - 1 });
                    }
                }
            }
        }

        return { nodes: resultNodes, edges: resultEdges, relevanceScores: scores };
    }

    private async createNode(data: Omit<KnowledgeNode, 'id' | 'createdAt' | 'updatedAt' | 'embedding'>): Promise<string> {
        const id = nanoid();
        const now = new Date().toISOString();

        let embedding: string | null = null;
        try {
            const embeddings = await this.llm.embeddings([data.title + ' ' + data.content.substring(0, 200)]);
            embedding = JSON.stringify(embeddings[0]);
        } catch {
            // Skip embedding if not available
        }

        db.prepare(`
            INSERT INTO knowledge_nodes (id, type, title, content, metadata, embedding, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, data.type, data.title, data.content, JSON.stringify(data.metadata), embedding, now, now);

        return id;
    }

    private createEdge(fromId: string, toId: string, relation: string, weight = 1.0): string {
        const id = nanoid();
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO knowledge_edges (id, from_id, to_id, relation, weight, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, fromId, toId, relation, weight, now);
        return id;
    }

    private getNode(id: string): KnowledgeNode | null {
        const row = db.prepare('SELECT * FROM knowledge_nodes WHERE id = ?').get(id) as any;
        return row ? { ...row, metadata: JSON.parse(row.metadata || '{}') } : null;
    }

    private getAllNodes(): Array<KnowledgeNode & { embedding: unknown }> {
        return (db.prepare('SELECT * FROM knowledge_nodes').all() as any[]).map(row => ({
            ...row,
            metadata: JSON.parse(row.metadata || '{}'),
        }));
    }

    private getEdges(nodeId: string): KnowledgeEdge[] {
        return (db.prepare('SELECT * FROM knowledge_edges WHERE from_id = ? OR to_id = ?').all(nodeId, nodeId) as any[]);
    }

    private chunkText(text: string, chunkSize: number): string[] {
        const chunks: string[] = [];
        const paragraphs = text.split(/\n\n+/);
        let current = '';
        for (const para of paragraphs) {
            if (current.length + para.length > chunkSize && current.length > 0) {
                chunks.push(current.trim());
                current = para;
            } else {
                current += (current ? '\n\n' : '') + para;
            }
        }
        if (current.trim()) chunks.push(current.trim());
        return chunks;
    }

    private async extractAndLinkEntities(docId: string, content: string): Promise<void> {
        const response = await this.llm.chat([{
            role: 'user',
            content: `从以下文本中提取关键实体和关系，输出 JSON 格式:
{"entities": [{"name": "...", "type": "concept|process|system|person", "description": "..."}],
 "relations": [{"from": "entity_name", "to": "entity_name", "relation": "depends_on|part_of|related_to"}]}

文本: ${content}`,
        }]);

        const text = typeof response.content === 'string' ? response.content : '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return;

        const extracted = JSON.parse(jsonMatch[0]);
        const entityIds = new Map<string, string>();

        for (const entity of extracted.entities || []) {
            const id = await this.createNode({
                type: entity.type || 'concept',
                title: entity.name,
                content: entity.description || entity.name,
                metadata: { extractedFrom: docId },
            });
            entityIds.set(entity.name, id);
            this.createEdge(docId, id, 'mentions', 0.8);
        }

        for (const rel of extracted.relations || []) {
            const fromId = entityIds.get(rel.from);
            const toId = entityIds.get(rel.to);
            if (fromId && toId) {
                this.createEdge(fromId, toId, rel.relation || 'related_to', 0.9);
            }
        }
    }

    getStats(): { nodeCount: number; edgeCount: number } {
        const nodeCount = (db.prepare('SELECT COUNT(*) as c FROM knowledge_nodes').get() as any).c;
        const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM knowledge_edges').get() as any).c;
        return { nodeCount, edgeCount };
    }
}
