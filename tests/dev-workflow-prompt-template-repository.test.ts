import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { DevWorkflowPromptTemplateRepository } from '../src/core/dev-workflow-prompt-template-repository.js';

function createTestDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    db.exec(`
        CREATE TABLE IF NOT EXISTS dev_workflow_prompt_templates (
            key TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL
        );
    `);
    return db;
}

describe('DevWorkflowPromptTemplateRepository', () => {
    let repo: DevWorkflowPromptTemplateRepository;

    beforeEach(() => {
        repo = new DevWorkflowPromptTemplateRepository(createTestDb() as any);
    });

    it('get() 未设置时返回 undefined', () => {
        expect(repo.get('dev-workflow.analysis')).toBeUndefined();
    });

    it('set() 后 get() 返回内容', () => {
        repo.set('dev-workflow.analysis', '自定义分析模板');
        expect(repo.get('dev-workflow.analysis')).toBe('自定义分析模板');
    });

    it('set() 对同一 key 重复调用会覆盖旧内容（upsert）', () => {
        repo.set('dev-workflow.implement', 'v1');
        repo.set('dev-workflow.implement', 'v2');
        expect(repo.get('dev-workflow.implement')).toBe('v2');
    });

    it('delete() 后 get() 回到 undefined', () => {
        repo.set('dev-workflow.split', '拆卡模板');
        repo.delete('dev-workflow.split');
        expect(repo.get('dev-workflow.split')).toBeUndefined();
    });
});
