import { describe, it, expect } from 'vitest';
import { countTokens } from '../src/core/tokenizer.js';

// P2-3: countTokens() 现在优先走 gpt-tokenizer 的 o200k_base 精确 BPE 编码，
// 而不是启发式估算。验证结果与已知的精确编码值一致（而不仅仅是"看起来合理"）。

describe('countTokens (P2-3: gpt-tokenizer o200k_base)', () => {
    it('returns 0 for empty string', () => {
        expect(countTokens('')).toBe(0);
    });

    it('matches exact o200k_base token count for known English text', () => {
        // 与直接调用 gpt-tokenizer 编码结果核对，锁定为精确值而非估算范围
        expect(countTokens('The quick brown fox jumps over the lazy dog')).toBe(9);
    });

    it('matches exact o200k_base token count for known CJK text', () => {
        expect(countTokens('我们的数据库配置在 config 目录')).toBe(7);
    });

    it('counts more tokens for longer text', () => {
        const short = countTokens('hello');
        const long = countTokens('hello '.repeat(50));
        expect(long).toBeGreaterThan(short);
    });

    it('handles mixed CJK/ASCII/JSON-like content without throwing', () => {
        const mixed = JSON.stringify({ 用户: 'Alice', preference: '深色主题', count: 42 });
        expect(() => countTokens(mixed)).not.toThrow();
        expect(countTokens(mixed)).toBeGreaterThan(0);
    });
});
