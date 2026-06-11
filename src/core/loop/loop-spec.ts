/**
 * LoopSpec — 目标驱动自治循环的声明式定义（U15: Loop Engineering）
 *
 * 与 Runbook 的区别：Runbook 是「步骤声明式」（怎么做），LoopSpec 是「目标声明式」
 * （做到什么程度）——循环自行 发现任务 → 执行 → 验证 → 纠错，直到目标达成或熔断。
 *
 * 核心原则：
 * 1. 验证优先用确定性手段（VerifierSpec：跑测试/查 API 状态），LLM 评分仅兜底
 * 2. goal 原语——由验证结果而非 LLM 自述判断「完成了没有」
 * 3. 预算熔断 + 停滞检测是无人值守的安全底线
 */

import { parse as parseYaml } from 'yaml';
import type { OutcomeSpec } from '../harness/outcome-spec.js';

/**
 * 确定性验证器：调用一个技能动作，对结果应用断言
 *
 * assert DSL：
 * - "ok"               工具执行成功（默认）
 * - "exit_code == 0"   等价于 ok（shell 类工具非零退出即 error）
 * - "contains:<text>"  输出包含文本
 * - "not_contains:<text>" 输出不包含文本
 * - "matches:<regex>"  输出匹配正则
 * - "equals:<text>"    输出去除首尾空白后全等
 */
export interface VerifierSpec {
    /** 技能动作，如 "shell.execute"、"http-client.get" */
    tool: string;
    params?: Record<string, unknown>;
    assert?: string;
    /** 报告中显示的名称（默认 tool + assert）*/
    name?: string;
}

export interface LoopSpec {
    id: string;
    name?: string;
    /** 循环级目标（必填）：写进每轮任务提示 */
    goal: string;

    /** 触发方式：cron 表达式 或 手动触发（默认 manual）*/
    trigger?: {
        cron?: string;
        manual?: boolean;
    };

    /**
     * 任务发现阶段（可选）：调用工具获取待处理任务清单。
     * emptyMeansDone=true（默认）时发现结果为空 → 视为目标已达成，循环正常结束。
     */
    discover?: {
        tool: string;
        params?: Record<string, unknown>;
        emptyMeansDone?: boolean;
    };

    /** 执行阶段：指定 AgentPool spec id，或直接用主 Agent（不指定时）*/
    execute: {
        /** AgentPool 中注册的 AgentSpec id（如 "coder"、"ops-worker"）*/
        agent?: string;
        /**
         * 任务提示模板。占位符：{{goal}}、{{discovered}}、{{feedback}}、{{iteration}}
         * 默认: "目标：{{goal}}\n\n{{discovered}}{{feedback}}"
         */
        promptTemplate?: string;
    };

    /** 确定性验证（优先于 grader）*/
    verify?: VerifierSpec[];

    /** LLM 评分兜底（处理模糊准则；verify 全过后才会执行）*/
    grader?: OutcomeSpec;

    budgets?: {
        /** 最大循环轮数（默认 10）*/
        maxIterations?: number;
        /** 最大累计 step 数（默认 500）*/
        maxSteps?: number;
        /** 最大墙钟时间（分钟，默认 60）*/
        maxWallClockMin?: number;
    };

    stall?: {
        /** 同一验证失败签名连续出现 N 轮判定为停滞（默认 3）*/
        noProgressRounds?: number;
    };

    /** 停滞/预算耗尽时的行为：escalate 升级人工（默认）/ stop 静默停止 */
    onStall?: 'escalate' | 'stop';
}

export interface LoopSpecValidationError extends Error {
    field: string;
}

function fail(field: string, message: string): never {
    const err = new Error(`LoopSpec 校验失败 [${field}]: ${message}`) as LoopSpecValidationError;
    err.field = field;
    throw err;
}

/**
 * 解析并校验 YAML 格式的 LoopSpec
 */
export function parseLoopSpec(yamlText: string): LoopSpec {
    const raw = parseYaml(yamlText) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') fail('root', '不是有效的 YAML 对象');
    return validateLoopSpec(raw);
}

/**
 * 校验对象形态的 LoopSpec（API 直传 JSON 时使用）
 */
export function validateLoopSpec(raw: Record<string, unknown>): LoopSpec {
    if (!raw.id || typeof raw.id !== 'string') fail('id', '必填且为字符串');
    if (!raw.goal || typeof raw.goal !== 'string') fail('goal', '必填且为字符串');

    const execute = raw.execute as LoopSpec['execute'] | undefined;
    if (!execute || typeof execute !== 'object') fail('execute', '必填');
    if (execute.agent !== undefined && typeof execute.agent !== 'string') {
        fail('execute.agent', '必须为字符串');
    }

    const discover = raw.discover as LoopSpec['discover'] | undefined;
    if (discover && (!discover.tool || typeof discover.tool !== 'string')) {
        fail('discover.tool', '配置 discover 时必填');
    }

    const verify = raw.verify as VerifierSpec[] | undefined;
    if (verify !== undefined) {
        if (!Array.isArray(verify)) fail('verify', '必须为数组');
        verify.forEach((v, i) => {
            if (!v.tool || typeof v.tool !== 'string') fail(`verify[${i}].tool`, '必填');
        });
    }

    const onStall = raw.onStall as string | undefined;
    if (onStall !== undefined && onStall !== 'escalate' && onStall !== 'stop') {
        fail('onStall', '只能是 escalate 或 stop');
    }

    return {
        id: raw.id,
        name: (raw.name as string) ?? raw.id,
        goal: raw.goal,
        trigger: raw.trigger as LoopSpec['trigger'],
        discover: discover ? { emptyMeansDone: true, ...discover } : undefined,
        execute,
        verify,
        grader: raw.grader as OutcomeSpec | undefined,
        budgets: {
            maxIterations: (raw.budgets as any)?.maxIterations ?? 10,
            maxSteps: (raw.budgets as any)?.maxSteps ?? 500,
            maxWallClockMin: (raw.budgets as any)?.maxWallClockMin ?? 60,
        },
        stall: {
            noProgressRounds: (raw.stall as any)?.noProgressRounds ?? 3,
        },
        onStall: (onStall as LoopSpec['onStall']) ?? 'escalate',
    };
}
