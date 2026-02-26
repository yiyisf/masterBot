import { nanoid } from 'nanoid';
import { db } from './database.js';

export interface WebhookConfig {
    id: string;
    name: string;
    secret: string;
    enabled: boolean;
    description?: string;
    createdAt: string;
    lastTriggeredAt?: string;
    triggerCount: number;
}

/**
 * Webhook configuration persistence
 */
export class WebhookRepository {
    create(data: { name: string; secret?: string; description?: string }): WebhookConfig {
        const id = nanoid();
        const secret = data.secret || nanoid(32);
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO webhooks (id, name, secret, enabled, description, created_at, trigger_count)
            VALUES (?, ?, ?, 1, ?, ?, 0)
        `).run(id, data.name, secret, data.description || null, now);

        return this.get(id)!;
    }

    get(id: string): WebhookConfig | null {
        const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as any;
        return row ? this.mapRow(row) : null;
    }

    list(): WebhookConfig[] {
        const rows = db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all() as any[];
        return rows.map(this.mapRow);
    }

    update(id: string, data: Partial<Pick<WebhookConfig, 'name' | 'enabled' | 'description'>>): void {
        const fields: string[] = [];
        const values: unknown[] = [];

        if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
        if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
        if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }

        if (fields.length === 0) return;
        values.push(id);
        db.prepare(`UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`).run(...values as import('node:sqlite').SQLInputValue[]);
    }

    delete(id: string): void {
        db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
    }

    recordTrigger(id: string): void {
        const now = new Date().toISOString();
        db.prepare(`
            UPDATE webhooks SET last_triggered_at = ?, trigger_count = trigger_count + 1 WHERE id = ?
        `).run(now, id);
    }

    private mapRow(row: any): WebhookConfig {
        return {
            id: row.id,
            name: row.name,
            secret: row.secret,
            enabled: Boolean(row.enabled),
            description: row.description || undefined,
            createdAt: row.created_at,
            lastTriggeredAt: row.last_triggered_at || undefined,
            triggerCount: row.trigger_count || 0,
        };
    }
}

export const webhookRepository = new WebhookRepository();
