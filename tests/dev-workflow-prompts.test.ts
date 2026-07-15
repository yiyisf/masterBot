import { describe, it, expect } from 'vitest';
import {
    buildStagePrompt,
    buildAnalysisPrompt,
    buildImplementPrompt,
    DEV_WORKFLOW_PROMPT_KEYS,
    type DevWorkflowPromptOverrides,
} from '../src/core/harness/dev-workflow-prompts.js';

const vars = { reqKey: 'cmasterBot#42', title: '支持导出 PDF', description: '周报详情页新增导出按钮' };

function fakeOverrides(map: Record<string, string>): DevWorkflowPromptOverrides {
    return { get: (key: string) => map[key] };
}

describe('dev-workflow-prompts', () => {
    it('buildStagePrompt(analysis) 用代码内置默认模板，插值需求上下文，并追加固定协议要求后缀', () => {
        const prompt = buildStagePrompt('analysis', vars);
        expect(prompt).toContain('cmasterBot#42');
        expect(prompt).toContain('支持导出 PDF');
        expect(prompt).toContain('周报详情页新增导出按钮');
        expect(prompt).toContain('grilling');
        expect(prompt).toContain('to-spec');
        expect(prompt).toContain('cmaster:questions');
        expect(prompt).toContain('cmaster:done');
    });

    it('buildStagePrompt(implement) 提及 implement skill 与 ask_user', () => {
        const prompt = buildStagePrompt('implement', vars);
        expect(prompt).toContain('implement');
        expect(prompt).toContain('ask_user');
        expect(prompt).toContain('cmaster:questions');
    });

    it('三个键各自独立，DB 覆盖模板优先于代码内置默认', () => {
        const overrides = fakeOverrides({
            [DEV_WORKFLOW_PROMPT_KEYS.analysis]: '自定义分析指令 {{reqKey}}',
            [DEV_WORKFLOW_PROMPT_KEYS.implement]: '自定义实现指令 {{title}}',
        });
        const analysis = buildStagePrompt('analysis', vars, overrides);
        expect(analysis).toContain('自定义分析指令 cmasterBot#42');
        expect(analysis).not.toContain('grilling'); // 默认模板的措辞不应残留

        const implement = buildStagePrompt('implement', vars, overrides);
        expect(implement).toContain('自定义实现指令 支持导出 PDF');

        // split 未被覆盖，仍走代码默认
        const split = buildStagePrompt('split', vars, overrides);
        expect(split).toContain('to-tickets');
    });

    it('协议要求后缀不受 DB 覆盖模板影响（即使覆盖模板本身不含协议文本也会被追加）', () => {
        const overrides = fakeOverrides({ [DEV_WORKFLOW_PROMPT_KEYS.analysis]: '完全自定义，不提协议' });
        const prompt = buildStagePrompt('analysis', vars, overrides);
        expect(prompt).toContain('cmaster:questions');
        expect(prompt).toContain('cmaster:done');
    });

    it('buildAnalysisPrompt 拼接 analysis+split 两段模板，协议要求后缀只出现一次', () => {
        const prompt = buildAnalysisPrompt(vars);
        expect(prompt).toContain('grilling');
        expect(prompt).toContain('to-spec');
        expect(prompt).toContain('to-tickets');
        expect(prompt.split('cmaster:questions')).toHaveLength(2); // 只出现一次 → split 后长度为 2
    });

    it('buildImplementPrompt 是 buildStagePrompt(implement) 的等价简写', () => {
        expect(buildImplementPrompt(vars)).toBe(buildStagePrompt('implement', vars));
    });

    it('description 缺失（null）时不报错，插值为空字符串', () => {
        const prompt = buildStagePrompt('analysis', { reqKey: 'cmasterBot#1', title: 'X', description: null });
        expect(prompt).toContain('cmasterBot#1');
        expect(prompt).not.toContain('null');
    });
});
