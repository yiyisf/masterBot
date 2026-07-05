import type { LLMAdapter, LLMConfig, TokenUsageEvent } from '../types.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';

/**
 * LLM 适配器工厂
 * 根据配置创建对应的 LLM 适配器实例
 */
export class LLMFactory {
    private adapters: Map<string, LLMAdapter> = new Map();
    /** P1-7: token 用量上报回调，由组合根注入，解耦适配器对 DB 的直接依赖 */
    private onUsage?: (usage: TokenUsageEvent) => void;

    /**
     * 设置 token 用量上报回调（组合根调用一次）。
     * 跨 clearCache() 持久有效，新建的适配器都会带上当前回调。
     */
    setUsageHandler(handler: (usage: TokenUsageEvent) => void): void {
        this.onUsage = handler;
    }

    /**
     * 创建或获取 LLM 适配器
     */
    getAdapter(name: string, config: LLMConfig): LLMAdapter {
        const cacheKey = `${name}:${config.baseUrl}:${config.model}`;

        if (this.adapters.has(cacheKey)) {
            return this.adapters.get(cacheKey)!;
        }

        const adapter = this.createAdapter(config);
        this.adapters.set(cacheKey, adapter);
        return adapter;
    }

    /**
     * 根据配置类型创建适配器
     */
    private createAdapter(config: LLMConfig): LLMAdapter {
        switch (config.type) {
            case 'openai':
                return new OpenAIAdapter(config, this.onUsage);
            case 'anthropic':
                return new AnthropicAdapter(config, this.onUsage);
            case 'gemini':
                // Gemini 支持 OpenAI 兼容 API
                return new OpenAIAdapter({
                    ...config,
                    baseUrl: config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai/',
                }, this.onUsage);
            case 'ollama':
                // Ollama 支持 OpenAI 兼容 API
                return new OpenAIAdapter({
                    ...config,
                    baseUrl: config.baseUrl || 'http://localhost:11434/v1',
                    apiKey: config.apiKey || 'ollama',
                }, this.onUsage);
            case 'custom':
                // 自定义适配器可以在这里扩展
                // 目前默认使用 OpenAI 兼容实现
                return new OpenAIAdapter(config, this.onUsage);
            default:
                throw new Error(`Unknown LLM provider type: ${config.type}`);
        }
    }

    /**
     * 清除缓存的适配器
     */
    clearCache(): void {
        this.adapters.clear();
    }
}

// 全局工厂实例
export const llmFactory = new LLMFactory();
