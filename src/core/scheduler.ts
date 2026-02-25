import { nanoid } from 'nanoid';
import { db } from './database.js';
import type { Logger } from '../types.js';

export interface ScheduledTask {
    id: string;
    name: string;
    cronExpr: string;        // cron expression like "0 9 * * *"
    prompt: string;          // prompt to send to agent
    sessionId?: string;
    enabled: boolean;
    lastRun?: string;
    nextRun?: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Simple cron expression parser - supports standard 5-field cron
 * Fields: minute hour day-of-month month day-of-week
 */
export function parseCron(expr: string): (date: Date) => boolean {
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5) throw new Error(`Invalid cron: ${expr}`);

    const [minF, hourF, domF, monF, dowF] = fields;

    function matchField(field: string, val: number, min: number, max: number): boolean {
        if (field === '*') return true;
        // Handle */step
        if (field.startsWith('*/')) {
            const step = parseInt(field.slice(2));
            return val % step === 0;
        }
        // Handle ranges like 1-5
        if (field.includes('-')) {
            const [lo, hi] = field.split('-').map(Number);
            return val >= lo && val <= hi;
        }
        // Handle lists like 1,3,5
        if (field.includes(',')) {
            return field.split(',').map(Number).includes(val);
        }
        return parseInt(field) === val;
    }

    return (date: Date) => {
        return matchField(minF, date.getMinutes(), 0, 59)
            && matchField(hourF, date.getHours(), 0, 23)
            && matchField(domF, date.getDate(), 1, 31)
            && matchField(monF, date.getMonth() + 1, 1, 12)
            && matchField(dowF, date.getDay(), 0, 6);
    };
}

/**
 * Calculates next run time for a cron expression (within next 24 hours)
 */
export function getNextRun(expr: string): Date | null {
    const matcher = parseCron(expr);
    const now = new Date();
    const check = new Date(now.getTime() + 60000); // start from next minute
    check.setSeconds(0, 0);

    for (let i = 0; i < 1440; i++) { // check up to 24 hours ahead
        if (matcher(check)) return check;
        check.setTime(check.getTime() + 60000);
    }
    return null;
}

export class SchedulerService {
    private logger: Logger;
    private timer?: NodeJS.Timeout;
    private onTrigger?: (task: ScheduledTask) => Promise<void>;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    setTriggerHandler(handler: (task: ScheduledTask) => Promise<void>) {
        this.onTrigger = handler;
    }

    start() {
        // Tick every minute on the exact minute boundary
        const tick = () => {
            this.checkAndRun();
            // Schedule next tick at next minute boundary
            const now = new Date();
            const msToNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
            this.timer = setTimeout(tick, msToNextMinute);
        };

        const now = new Date();
        const msToNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
        this.timer = setTimeout(tick, msToNextMinute);
        this.logger.info(`[scheduler] Started, first tick in ${Math.round(msToNextMinute / 1000)}s`);
    }

    stop() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private async checkAndRun() {
        const now = new Date();
        const tasks = this.getTasks();

        for (const task of tasks) {
            if (!task.enabled) continue;
            try {
                const matcher = parseCron(task.cronExpr);
                if (matcher(now)) {
                    this.logger.info(`[scheduler] Triggering task: ${task.name}`);
                    this.updateLastRun(task.id, now.toISOString());
                    if (this.onTrigger) {
                        this.onTrigger(task).catch(err => {
                            this.logger.error(`[scheduler] Task ${task.name} failed: ${err.message}`);
                        });
                    }
                }
            } catch (err) {
                this.logger.error(`[scheduler] Error checking task ${task.name}: ${(err as Error).message}`);
            }
        }
    }

    getTasks(): ScheduledTask[] {
        return (db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as any[]).map(row => ({
            ...row,
            enabled: row.enabled === 1,
        }));
    }

    getTask(id: string): ScheduledTask | null {
        const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as any;
        return row ? { ...row, enabled: row.enabled === 1 } : null;
    }

    createTask(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt'>): string {
        const id = nanoid();
        const now = new Date().toISOString();
        const nextRun = task.enabled ? getNextRun(task.cronExpr)?.toISOString() : null;

        db.prepare(`
            INSERT INTO scheduled_tasks (id, name, cron_expr, prompt, session_id, enabled, next_run, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, task.name, task.cronExpr, task.prompt, task.sessionId ?? null, task.enabled ? 1 : 0, nextRun ?? null, now, now);

        return id;
    }

    updateTask(id: string, updates: Partial<Omit<ScheduledTask, 'id' | 'createdAt'>>): void {
        const now = new Date().toISOString();
        const task = this.getTask(id);
        if (!task) throw new Error(`Scheduled task ${id} not found`);

        const merged = { ...task, ...updates };
        const nextRun = merged.enabled ? getNextRun(merged.cronExpr)?.toISOString() : null;

        db.prepare(`
            UPDATE scheduled_tasks
            SET name = ?, cron_expr = ?, prompt = ?, session_id = ?, enabled = ?, next_run = ?, updated_at = ?
            WHERE id = ?
        `).run(merged.name, merged.cronExpr, merged.prompt, merged.sessionId ?? null, merged.enabled ? 1 : 0, nextRun ?? null, now, id);
    }

    deleteTask(id: string): void {
        db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
    }

    private updateLastRun(id: string, lastRun: string): void {
        const task = this.getTask(id);
        if (!task) return;
        const nextRun = getNextRun(task.cronExpr)?.toISOString() || null;
        db.prepare('UPDATE scheduled_tasks SET last_run = ?, next_run = ?, updated_at = ? WHERE id = ?')
            .run(lastRun, nextRun, new Date().toISOString(), id);
    }
}

export const schedulerService = new SchedulerService({
    debug: () => {}, info: console.log, warn: console.warn, error: console.error
});
