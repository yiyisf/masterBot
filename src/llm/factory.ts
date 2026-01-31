import type { LLMAdapter, LLMConfig } from '../types.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';

/**
 * LLM 适配器工厂
 * 根据配置创建对应的 LLM 适配器实例
 */
export class LLMFactory {
    private adapters: Map<string, LLMAdapter> = new Map();

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
                return new OpenAIAdapter(config);
            case 'anthropic':
                return new AnthropicAdapter(config);
            case 'custom':
                // 自定义适配器可以在这里扩展
                // 目前默认使用 OpenAI 兼容实现
                return new OpenAIAdapter(config);
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
