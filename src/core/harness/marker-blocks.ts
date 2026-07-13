/**
 * 标记块协议解析器（spec #85，地图 #74 ticket #78 决策）：agent 回复文本中用自定义 fenced
 * code block 输出问题/完成信号，平台按此解析——不依赖具体引擎的原生结构化输出格式，
 * 跨 claude-code/codex/opencode/pi 四引擎统一。
 *
 * 协议：
 * - ```cmaster:questions``` 块：JSON `{"questions": [...]}`，agent 需要人工回答时输出。
 * - ```cmaster:done``` 块：JSON（阶段产物，如 {"analysisSpec": {...}, "cards": [...]}），
 *   阶段/任务完成时输出。
 *
 * 取回复中最后一个匹配的标记块（agent 可能在思考过程中提及格式示例，只有最后一个才是
 * 真正的信号）；两种标记块都没有出现视为协议违约，由调用方（RequirementExecutionService）
 * 决定重试/失败。
 */

export type MarkerName = 'cmaster:questions' | 'cmaster:done';

function markerRegex(marker: MarkerName): RegExp {
    return new RegExp('```' + marker + '\\s*\\n([\\s\\S]*?)```', 'g');
}

/** 取文本中最后一个匹配标记块并解析为 JSON；未出现或 JSON 非法均返回 undefined（非法内容不抛错）*/
export function extractMarkerBlock(text: string, marker: MarkerName): unknown | undefined {
    const matches = [...text.matchAll(markerRegex(marker))];
    if (matches.length === 0) return undefined;
    const last = matches[matches.length - 1][1].trim();
    try {
        return JSON.parse(last);
    } catch {
        return undefined;
    }
}

export interface PendingQuestionLike {
    id: string;
    question: string;
    context?: string;
    options?: Array<{ label: string; description?: string }>;
    recommended?: number;
    multiSelect?: boolean;
}

export interface QuestionsBlock {
    questions: PendingQuestionLike[];
}

export interface DoneBlock {
    analysisSpec?: { goal?: string; scope?: string; acceptance?: string; [key: string]: unknown };
    cards?: Array<{ title: string }>;
    [key: string]: unknown;
}

/** 校验+narrow：取到的 JSON 必须形如 { questions: [...] } 且非空数组，否则视为未取到 */
export function extractQuestionsBlock(text: string): QuestionsBlock | undefined {
    const parsed = extractMarkerBlock(text, 'cmaster:questions');
    if (!parsed || typeof parsed !== 'object') return undefined;
    const questions = (parsed as Record<string, unknown>).questions;
    if (!Array.isArray(questions) || questions.length === 0) return undefined;
    return { questions: questions as PendingQuestionLike[] };
}

/** done 块允许是空对象 `{}`（如单卡实现完成，没有额外产物）——只要标记块本身存在即可 */
export function extractDoneBlock(text: string): DoneBlock | undefined {
    const parsed = extractMarkerBlock(text, 'cmaster:done');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as DoneBlock;
}

export type ParsedMarker =
    | { type: 'questions'; questions: PendingQuestionLike[] }
    | { type: 'done'; data: DoneBlock };

/**
 * 找文本中最后一个标记块（不区分是 questions 还是 done），据此判断 agent 最终想表达的信号——
 * 两种标记块各自独立提取（extractQuestionsBlock/extractDoneBlock）都只知道"某种类型最后一次
 * 出现在哪"，不知道两种类型相互之间谁更晚；例如 agent 先问了一个问题（questions）又改口直接
 * 完成了（done），此时应以 done 为准，反之亦然——只有看两者在文本里的相对位置才能判断。
 */
export function extractLastMarker(text: string): ParsedMarker | undefined {
    const combined = /```(cmaster:questions|cmaster:done)\s*\n([\s\S]*?)```/g;
    const matches = [...text.matchAll(combined)];
    if (matches.length === 0) return undefined;

    const [, marker, body] = matches[matches.length - 1];
    let parsed: unknown;
    try {
        parsed = JSON.parse(body.trim());
    } catch {
        return undefined;
    }

    if (marker === 'cmaster:questions') {
        if (!parsed || typeof parsed !== 'object') return undefined;
        const questions = (parsed as Record<string, unknown>).questions;
        if (!Array.isArray(questions) || questions.length === 0) return undefined;
        return { type: 'questions', questions: questions as PendingQuestionLike[] };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return { type: 'done', data: parsed as DoneBlock };
}
