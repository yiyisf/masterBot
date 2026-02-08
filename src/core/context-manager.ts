import type { Message, LLMAdapter, Logger } from '../types.js';

/**
 * 上下文窗口管理器
 * 防止消息历史超出 LLM context limit
 *
 * 策略：滑动窗口 + 摘要压缩
 * - 保留最近 N 条消息
 * - 更早的消息由 LLM 摘要后压缩为 1 条 system message
 */
export class ContextManager {
    private maxTokens: number;
    private reservedTokens: number;
    private logger: Logger;

    constructor(options: {
        maxTokens?: number;
        reservedTokens?: number;
        logger: Logger;
    }) {
        // Default 120k tokens context, reserve 4k for response
        this.maxTokens = options.maxTokens ?? 120000;
        this.reservedTokens = options.reservedTokens ?? 4096;
        this.logger = options.logger;
    }

    /**
     * 估算消息的 token 数
     * 简单实现：按字符数 / 3 估算（英文约 4 字符/token，中文约 1.5 字符/token）
     */
    estimateTokens(messages: Message[]): number {
        let total = 0;
        for (const msg of messages) {
            const content = typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content);
            // Rough estimate: mix of CJK and ASCII
            total += Math.ceil(content.length / 3);

            if (msg.toolCalls) {
                total += Math.ceil(JSON.stringify(msg.toolCalls).length / 3);
            }
        }
        return total;
    }

    /**
     * 裁剪消息历史使其不超出上下文窗口
     *
     * @param systemMessage - 系统提示词（始终保留）
     * @param history - 历史消息（可被裁剪/摘要）
     * @param currentMessages - 当前轮次的消息（始终保留）
     * @param llm - 用于生成摘要的 LLM 适配器（可选）
     * @returns 裁剪后的完整消息数组
     */
    async trimMessages(
        systemMessage: Message,
        history: Message[],
        currentMessages: Message[],
        llm?: LLMAdapter
    ): Promise<Message[]> {
        const budget = this.maxTokens - this.reservedTokens;

        // Tokens consumed by fixed parts (system + current)
        const fixedTokens = this.estimateTokens([systemMessage, ...currentMessages]);

        if (fixedTokens >= budget) {
            // Even without history we're over budget - just return what we must
            this.logger.warn(`System + current messages alone exceed token budget (${fixedTokens} >= ${budget})`);
            return [systemMessage, ...currentMessages];
        }

        const historyBudget = budget - fixedTokens;
        const historyTokens = this.estimateTokens(history);

        // History fits within budget - no trimming needed
        if (historyTokens <= historyBudget) {
            return [systemMessage, ...history, ...currentMessages];
        }

        this.logger.info(`Context window trimming: history ${historyTokens} tokens exceeds budget ${historyBudget}`);

        // Strategy: keep recent messages, summarize older ones
        const { kept, trimmed } = this.splitHistory(history, historyBudget);

        if (trimmed.length === 0) {
            return [systemMessage, ...kept, ...currentMessages];
        }

        // Generate summary of trimmed messages
        let summaryMessage: Message;
        if (llm) {
            try {
                summaryMessage = await this.generateSummary(trimmed, llm);
            } catch (error) {
                this.logger.warn(`Summary generation failed, using fallback: ${(error as Error).message}`);
                summaryMessage = this.fallbackSummary(trimmed);
            }
        } else {
            summaryMessage = this.fallbackSummary(trimmed);
        }

        return [systemMessage, summaryMessage, ...kept, ...currentMessages];
    }

    /**
     * 将历史消息分为保留部分和需要摘要的部分
     * 从最新的消息开始保留，直到达到 budget
     */
    private splitHistory(
        history: Message[],
        tokenBudget: number
    ): { kept: Message[]; trimmed: Message[] } {
        // Reserve ~20% budget for summary message itself
        const keepBudget = Math.floor(tokenBudget * 0.8);

        let keptTokens = 0;
        let splitIndex = history.length;

        // Walk backwards from most recent, keeping messages that fit
        for (let i = history.length - 1; i >= 0; i--) {
            const msgTokens = this.estimateTokens([history[i]]);
            if (keptTokens + msgTokens > keepBudget) {
                splitIndex = i + 1;
                break;
            }
            keptTokens += msgTokens;
            if (i === 0) splitIndex = 0;
        }

        // Ensure we keep at least the most recent pair (user + assistant)
        if (splitIndex >= history.length - 1) {
            splitIndex = Math.max(0, history.length - 2);
        }

        return {
            trimmed: history.slice(0, splitIndex),
            kept: history.slice(splitIndex),
        };
    }

    /**
     * 使用 LLM 生成历史消息摘要
     */
    private async generateSummary(messages: Message[], llm: LLMAdapter): Promise<Message> {
        const conversationText = messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => {
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                return `${m.role}: ${content.slice(0, 500)}`;
            })
            .join('\n');

        const response = await llm.chat([
            {
                role: 'user',
                content: `请用简洁的中文概括以下对话的要点（不超过 200 字），保留关键信息和上下文：\n\n${conversationText.slice(0, 3000)}`
            }
        ]);

        const summary = typeof response.content === 'string'
            ? response.content
            : response.content.map(p => p.type === 'text' ? p.text : '').join('');

        this.logger.info(`Generated context summary (${messages.length} messages → ~${summary.length} chars)`);

        return {
            role: 'system',
            content: `[以下是之前对话的摘要]\n${summary}\n[摘要结束，以下是最近的对话]`,
        };
    }

    /**
     * 回退摘要：简单截取关键消息
     */
    private fallbackSummary(messages: Message[]): Message {
        const userMessages = messages.filter(m => m.role === 'user');
        const topics = userMessages
            .slice(-5)
            .map(m => {
                const content = typeof m.content === 'string' ? m.content : '';
                return content.slice(0, 100);
            })
            .filter(Boolean);

        return {
            role: 'system',
            content: `[之前的对话涉及以下主题：${topics.join('；')}。共 ${messages.length} 条消息已被压缩。]`,
        };
    }
}
