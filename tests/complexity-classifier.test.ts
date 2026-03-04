import { describe, it, expect } from 'vitest';
import { classifyComplexity } from '../src/core/complexity-classifier.js';

describe('Adaptive AI Thinking - Complexity Classifier', () => {
    it('classifies simple greetings as Tier 1', () => {
        expect(classifyComplexity('你好，今天天气怎么样', 0)).toBe(1);
        expect(classifyComplexity('hi', 0)).toBe(1);
    });

    it('classifies normal queries as Tier 2 if tools are present', () => {
        expect(classifyComplexity('你好，今天天气怎么样', 2)).toBe(2);
    });

    it('classifies standard tasks as Tier 2', () => {
        expect(classifyComplexity('帮我查一下数据库订单', 3)).toBe(2);
        expect(classifyComplexity('把这个文件翻译成因为', 1)).toBe(2);
    });

    it('classifies heavy AIOps tasks as Tier 3 based on keywords', () => {
        expect(classifyComplexity('服务器出现 OOM，请排查根因', 2)).toBe(3);
        expect(classifyComplexity('帮我执行 runbook', 1)).toBe(3);
        expect(classifyComplexity('请写出这个模块的对比分析报告', 0)).toBe(3);
        expect(classifyComplexity('有一个复杂的bug需要调试', 2)).toBe(3);
    });

    it('classifies high-tool-count environments as Tier 3', () => {
        // Even a simple prompt gets Tier 3 routing if it has to orchestrate 6+ tools
        expect(classifyComplexity('启动所有的日常流程', 6)).toBe(3);
    });
});
