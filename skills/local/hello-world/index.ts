import type { SkillContext } from '../../../src/types.js';

/**
 * 问候动作
 */
export async function greet(
    ctx: SkillContext,
    params: { name: string; language?: string }
): Promise<string> {
    const { name, language = 'zh' } = params;
    ctx.logger.info(`[hello-world] greet: ${name} (${language})`);

    if (language === 'en') {
        return `Hello, ${name}! Welcome to CMaster Bot. This is a local skill demo.`;
    }
    return `你好，${name}！欢迎使用 CMaster Bot。这是一个本地技能演示。`;
}

/**
 * 计算动作
 */
export async function calculate(
    ctx: SkillContext,
    params: { expression: string }
): Promise<string> {
    const { expression } = params;
    ctx.logger.info(`[hello-world] calculate: ${expression}`);

    // 安全的基础计算（只允许数字和基础运算符）
    if (!/^[\d\s\+\-\*\/\(\)\.]+$/.test(expression)) {
        throw new Error(`不支持的表达式: ${expression}。只支持数字和 +、-、*、/ 运算符。`);
    }

    try {
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict"; return (${expression})`)();
        return `${expression} = ${result}`;
    } catch (err) {
        throw new Error(`计算失败: ${(err as Error).message}`);
    }
}
