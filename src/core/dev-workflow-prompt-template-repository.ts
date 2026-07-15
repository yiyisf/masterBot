import { db } from './database.js';

/**
 * 两阶段自动化调度层 prompt 模板的 DB 覆盖层（spec #85）：代码内置默认模板 + 本表按键覆盖，
 * 页面可调模板内容不需要发版。与面向终端用户的通用 prompt_templates（聊天提示词库）无关，
 * 本表内容不对外暴露。
 */
export class DevWorkflowPromptTemplateRepository {
    private db: typeof db;

    constructor(database?: typeof db) {
        this.db = database ?? db;
    }

    get(key: string): string | undefined {
        const row = this.db.prepare('SELECT content FROM dev_workflow_prompt_templates WHERE key = ?')
            .get(key) as { content: string } | undefined;
        return row?.content;
    }

    set(key: string, content: string): void {
        const now = new Date().toISOString();
        this.db.prepare(
            `INSERT INTO dev_workflow_prompt_templates (key, content, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
        ).run(key, content, now);
    }

    delete(key: string): void {
        this.db.prepare('DELETE FROM dev_workflow_prompt_templates WHERE key = ?').run(key);
    }
}

export const devWorkflowPromptTemplateRepository = new DevWorkflowPromptTemplateRepository();
