import { nanoid } from 'nanoid';
import type { Logger } from '../types.js';
import { db } from './database.js';

type FailureType = 'tool_missing' | 'wrong_answer' | 'timeout' | 'other';

interface ImprovementEvent {
    id: string;
    trigger: string;
    sessionId?: string;
    analysis?: string;
    action: 'skill_generated' | 'no_action';
    skillName?: string;
}

/**
 * 自我学习闭环引擎
 * 在收到负向 feedback 时异步触发，分析失败原因并按需生成新技能
 */
export class SelfImprovementEngine {
    constructor(
        private agent: any,
        private logger: Logger
    ) {}

    /**
     * 入口：收到负向 feedback 时调用（异步，不阻塞响应）
     */
    async onNegativeFeedback(messageId: string, sessionId: string): Promise<void> {
        this.logger.info(`[SelfImprovement] Processing negative feedback for message ${messageId}`);

        try {
            // 获取消息内容
            const msgRow = db.prepare('SELECT content FROM messages WHERE id = ?').get(messageId) as { content: string } | undefined;
            if (!msgRow) {
                this.logger.warn(`[SelfImprovement] Message ${messageId} not found`);
                return;
            }

            // Step 1: LLM 分类失败原因
            const failureType = await this.classifyFailure(msgRow.content);
            this.logger.info(`[SelfImprovement] Failure classified as: ${failureType}`);

            // Step 2: 仅在 tool_missing 时生成技能
            let action: 'skill_generated' | 'no_action' = 'no_action';
            let skillName: string | undefined;

            if (failureType === 'tool_missing') {
                const generated = await this.maybeGenerateSkill(sessionId, msgRow.content);
                if (generated) {
                    action = 'skill_generated';
                    skillName = generated;
                }
            }

            // Step 3: 记录改进事件
            this.logEvent({
                id: nanoid(),
                trigger: 'negative_feedback',
                sessionId,
                analysis: `Classified as: ${failureType}`,
                action,
                skillName,
            });

        } catch (err: any) {
            this.logger.error(`[SelfImprovement] Error processing feedback: ${err.message}`);
        }
    }

    /**
     * 用 LLM 快速分类失败原因（temperature=0）
     */
    private async classifyFailure(messageContent: string): Promise<FailureType> {
        try {
            const llm = this.agent.getLLMAdapter();
            const result = await llm.chat(
                [
                    {
                        role: 'system',
                        content: 'You are a failure classifier. Respond with ONLY one of these labels: tool_missing, wrong_answer, timeout, other. No other text.',
                    },
                    {
                        role: 'user',
                        content: `Classify why this AI response was rated negatively:\n\n${messageContent.slice(0, 500)}`,
                    },
                ],
                { temperature: 0, maxTokens: 20 }
            );

            const label = (typeof result.content === 'string' ? result.content : '').trim().toLowerCase();
            if (['tool_missing', 'wrong_answer', 'timeout', 'other'].includes(label)) {
                return label as FailureType;
            }
            return 'other';
        } catch {
            return 'other';
        }
    }

    /**
     * 触发 skill_generate 工具生成新技能
     */
    private async maybeGenerateSkill(sessionId: string, reason: string): Promise<string | null> {
        try {
            const { SkillGenerator } = await import('./skill-generator.js');
            if (!this.agent.skillGenerator && !(this.agent as any)._skillGenerator) {
                return null;
            }
            const skillGen: any = (this.agent as any).skillGenerator ?? (this.agent as any)._skillGenerator;

            // 用 LLM 推断缺少哪个技能
            const llm = this.agent.getLLMAdapter();
            const inferResult = await llm.chat(
                [
                    {
                        role: 'system',
                        content: 'You infer missing tool capabilities from failed AI responses. Reply with a JSON object: {"name":"skill-name","description":"one sentence","actions":[{"name":"action_name","description":"what it does"}]}. No other text.',
                    },
                    {
                        role: 'user',
                        content: `This AI response failed because it lacked a tool. Infer the missing skill:\n\n${reason.slice(0, 600)}`,
                    },
                ],
                { temperature: 0, maxTokens: 300 }
            );

            const raw = typeof inferResult.content === 'string' ? inferResult.content : '';
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const spec = JSON.parse(jsonMatch[0]);
            if (!spec.name || !spec.actions?.length) return null;

            this.logger.info(`[SelfImprovement] Generating skill: ${spec.name}`);
            const generated = await skillGen.generate(spec);
            await skillGen.install(generated);

            return spec.name;
        } catch (err: any) {
            this.logger.warn(`[SelfImprovement] Skill generation failed: ${err.message}`);
            return null;
        }
    }

    private logEvent(event: ImprovementEvent): void {
        try {
            db.prepare(
                'INSERT INTO improvement_events (id, trigger, session_id, analysis, action, skill_name) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(
                event.id,
                event.trigger,
                event.sessionId ?? null,
                event.analysis ?? null,
                event.action,
                event.skillName ?? null
            );
            this.logger.info(`[SelfImprovement] Logged improvement event: ${event.action}`);
        } catch (err: any) {
            this.logger.error(`[SelfImprovement] Failed to log event: ${err.message}`);
        }
    }
}
