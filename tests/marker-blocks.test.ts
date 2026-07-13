import { describe, it, expect } from 'vitest';
import { extractMarkerBlock, extractQuestionsBlock, extractDoneBlock, extractLastMarker } from '../src/core/harness/marker-blocks.js';

describe('marker-blocks', () => {
    describe('extractMarkerBlock', () => {
        it('提取单个标记块并解析 JSON', () => {
            const text = '一些前置文字\n```cmaster:done\n{"foo":"bar"}\n```\n后续文字';
            expect(extractMarkerBlock(text, 'cmaster:done')).toEqual({ foo: 'bar' });
        });

        it('取最后一个匹配块（agent 可能在思考过程里提过格式示例）', () => {
            const text = [
                '示例格式：```cmaster:done\n{"foo":"draft"}\n```',
                '真正的结果：```cmaster:done\n{"foo":"final"}\n```',
            ].join('\n');
            expect(extractMarkerBlock(text, 'cmaster:done')).toEqual({ foo: 'final' });
        });

        it('未出现该标记块时返回 undefined', () => {
            expect(extractMarkerBlock('普通回复，没有标记块', 'cmaster:done')).toBeUndefined();
        });

        it('标记块内容不是合法 JSON 时返回 undefined（不抛错）', () => {
            const text = '```cmaster:done\n这不是 JSON\n```';
            expect(extractMarkerBlock(text, 'cmaster:done')).toBeUndefined();
        });

        it('两种标记块互不干扰，各自独立提取', () => {
            const text = '```cmaster:questions\n{"questions":[]}\n```\n```cmaster:done\n{"ok":true}\n```';
            expect(extractMarkerBlock(text, 'cmaster:questions')).toEqual({ questions: [] });
            expect(extractMarkerBlock(text, 'cmaster:done')).toEqual({ ok: true });
        });
    });

    describe('extractQuestionsBlock', () => {
        it('提取合法的 questions 数组', () => {
            const text = '```cmaster:questions\n{"questions":[{"id":"q1","question":"用什么版式？"}]}\n```';
            expect(extractQuestionsBlock(text)).toEqual({ questions: [{ id: 'q1', question: '用什么版式？' }] });
        });

        it('questions 为空数组时视为未取到（没有实际问题）', () => {
            const text = '```cmaster:questions\n{"questions":[]}\n```';
            expect(extractQuestionsBlock(text)).toBeUndefined();
        });

        it('缺少 questions 字段时视为未取到', () => {
            const text = '```cmaster:questions\n{"foo":"bar"}\n```';
            expect(extractQuestionsBlock(text)).toBeUndefined();
        });
    });

    describe('extractDoneBlock', () => {
        it('提取携带分析规格与卡片的 done 块', () => {
            const text = '```cmaster:done\n{"analysisSpec":{"goal":"g","scope":"s","acceptance":"a"},"cards":[{"title":"卡1"},{"title":"卡2"}]}\n```';
            const done = extractDoneBlock(text);
            expect(done?.analysisSpec).toEqual({ goal: 'g', scope: 's', acceptance: 'a' });
            expect(done?.cards).toEqual([{ title: '卡1' }, { title: '卡2' }]);
        });

        it('空对象 done 块也算取到（如单卡实现完成，没有额外产物）', () => {
            const text = '```cmaster:done\n{}\n```';
            expect(extractDoneBlock(text)).toEqual({});
        });

        it('done 块内容是数组而非对象时视为未取到', () => {
            const text = '```cmaster:done\n[1,2,3]\n```';
            expect(extractDoneBlock(text)).toBeUndefined();
        });
    });

    describe('extractLastMarker', () => {
        it('只有 questions 块时返回 questions 类型', () => {
            const text = '```cmaster:questions\n{"questions":[{"id":"q1","question":"？"}]}\n```';
            expect(extractLastMarker(text)).toEqual({ type: 'questions', questions: [{ id: 'q1', question: '？' }] });
        });

        it('只有 done 块时返回 done 类型', () => {
            const text = '```cmaster:done\n{"ok":true}\n```';
            expect(extractLastMarker(text)).toEqual({ type: 'done', data: { ok: true } });
        });

        it('两种都出现时，取文本中位置更靠后的那一个（不是按类型各自的最后一次）', () => {
            const questionsThenDone = '```cmaster:questions\n{"questions":[{"id":"q1","question":"？"}]}\n```\n```cmaster:done\n{"ok":true}\n```';
            expect(extractLastMarker(questionsThenDone)).toEqual({ type: 'done', data: { ok: true } });

            const doneThenQuestions = '```cmaster:done\n{"ok":true}\n```\n```cmaster:questions\n{"questions":[{"id":"q1","question":"？"}]}\n```';
            expect(extractLastMarker(doneThenQuestions)).toEqual({ type: 'questions', questions: [{ id: 'q1', question: '？' }] });
        });

        it('都没有出现时返回 undefined（协议违约的判定依据）', () => {
            expect(extractLastMarker('普通回复，没有任何标记块')).toBeUndefined();
        });

        it('最后一个标记块内容非法（如 questions 数组为空）时返回 undefined', () => {
            const text = '```cmaster:questions\n{"questions":[]}\n```';
            expect(extractLastMarker(text)).toBeUndefined();
        });
    });
});
