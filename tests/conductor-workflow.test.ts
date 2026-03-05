import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actions } from '../skills/built-in/conductor-workflow/index.js';
import type { SkillContext } from '../src/types.js';

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

describe('Conductor Workflow Skill', () => {
    let mockContext: SkillContext;
    let mockLlmChat: any;

    beforeEach(() => {
        mockLlmChat = vi.fn();
        mockContext = {
            sessionId: 'test-session',
            memory: { get: vi.fn(), set: vi.fn(), search: vi.fn() },
            logger: mockLogger,
            config: {},
            llm: {
                chat: mockLlmChat
            } as any
        };
        vi.clearAllMocks();
    });

    describe('generate_workflow', () => {
        it('should successfully extract and return valid WorkflowDef JSON', async () => {
            const validWorkflowResp = {
                name: 'Test_Workflow',
                description: 'Test',
                version: 1,
                tasks: [
                    {
                        name: 'task_1',
                        taskReferenceName: 't1',
                        type: 'SIMPLE'
                    }
                ]
            };

            mockLlmChat.mockResolvedValueOnce({
                content: `Here is the JSON:
\`\`\`json
${JSON.stringify(validWorkflowResp)}
\`\`\`
`
            });

            const result = await actions['generate_workflow'].handler(mockContext, { description: 'Test' }) as any;
            expect(result).toBeDefined();
            expect(result.workflow).toBeDefined();
            expect(result.workflow.name).toBe('Test_Workflow');
            expect(mockLlmChat).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if LLM returns invalid JSON structure', async () => {
            mockLlmChat.mockResolvedValueOnce({
                content: `\`\`\`json
{ "invalid": "data" }
\`\`\``
            });

            const result = await actions['generate_workflow'].handler(mockContext, { description: 'x' }) as any;
            expect(result.allValid).toBe(false);
            expect(result.validation[0].errors).toContain('Missing or invalid "name" field');
        });

        it('should throw an error if JSON block is missing', async () => {
            mockLlmChat.mockResolvedValueOnce({
                content: `Sorry, I cannot do that.`
            });

            const result = await actions['generate_workflow'].handler(mockContext, { description: 'x' }) as any;
            expect(result.success).toBe(false);
            expect(result.error).toContain('未能从生成结果中提取到有效的 JSON');
        });
    });

    describe('analyze_workflow', () => {
        it('should request analysis and return LLM string', async () => {
            mockLlmChat.mockResolvedValueOnce({
                content: `Analysis passed.`
            });

            const result = await actions['analyze_workflow'].handler(mockContext, {
                workflow_json: '{"name": "w"}'
            }) as any;

            expect(result.analysis).toBe('Analysis passed.');
            expect(mockLlmChat).toHaveBeenCalledTimes(1);
        });
    });

    describe('update_workflow', () => {
        it('should successfully extract and return valid updated WorkflowDef JSON', async () => {
            const validWorkflowResp = {
                name: 'Updated_Workflow',
                description: 'Updated',
                version: 2,
                tasks: []
            };

            mockLlmChat.mockResolvedValueOnce({
                content: `\`\`\`json
${JSON.stringify(validWorkflowResp)}
\`\`\`
`
            });

            const result = await actions['update_workflow'].handler(mockContext, {
                workflow_json: '{"name":"a"}',
                instruction: 'Change name'
            }) as any;

            expect(result.workflow.name).toBe('Updated_Workflow');
        });
    });

});
