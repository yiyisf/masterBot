import type { SkillContext, Message, MessageContentPart } from '../../../src/types.js';
import { readFileSync, existsSync } from 'fs';
import { extname } from 'path';

// Supported image extensions
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

const MIME_MAP: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
};

function buildImageContentPart(imagePath?: string, imageUrl?: string): MessageContentPart {
    if (imageUrl) {
        return { type: 'image_url', image_url: { url: imageUrl } };
    }
    if (imagePath) {
        if (!existsSync(imagePath)) {
            throw new Error(`图像文件不存在: ${imagePath}`);
        }
        const ext = extname(imagePath).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(ext)) {
            throw new Error(`不支持的图像格式: ${ext}。支持: ${[...IMAGE_EXTENSIONS].join(', ')}`);
        }
        const buffer = readFileSync(imagePath);
        const base64 = buffer.toString('base64');
        const mimeType = MIME_MAP[ext] || 'image/jpeg';
        return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } };
    }
    throw new Error('必须提供 image_path 或 image_url 之一');
}

async function callVisionLLM(
    ctx: SkillContext,
    prompt: string,
    imagePath?: string,
    imageUrl?: string
): Promise<string> {
    // Build image content part using the project's MessageContentPart type
    const imageContentPart = buildImageContentPart(imagePath, imageUrl);

    const userMessage: Message = {
        role: 'user',
        content: [
            { type: 'text', text: prompt },
            imageContentPart,
        ],
    };

    // Get the LLM adapter from the factory using env vars (OpenAI-compatible)
    const { llmFactory } = await import('../../../src/llm/index.js');

    // Create an adapter from env vars, cached by the factory under 'vision-openai'
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    if (!apiKey) {
        throw new Error('视觉技能需要 OPENAI_API_KEY 环境变量（使用 OpenAI 兼容的视觉模型）');
    }

    const adapter = llmFactory.getAdapter('vision-openai', {
        type: 'openai',
        baseUrl,
        apiKey,
        model,
    });

    const response = await adapter.chat([userMessage]);
    return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
}

/**
 * 分析图像内容
 */
export async function analyze_image(
    ctx: SkillContext,
    params: { image_path?: string; image_url?: string; question: string }
): Promise<string> {
    ctx.logger.info(`[vision] analyze_image`);
    if (!params.question) {
        throw new Error('必须提供 question 参数');
    }
    return callVisionLLM(ctx, params.question, params.image_path, params.image_url);
}

/**
 * OCR 文字识别
 */
export async function ocr(
    ctx: SkillContext,
    params: { image_path?: string; image_url?: string }
): Promise<string> {
    ctx.logger.info(`[vision] ocr`);
    const prompt = '请识别并提取这张图片中所有的文字内容，按照原始布局尽量保持格式，用中文回答。如果图片中没有文字，请说明。';
    return callVisionLLM(ctx, prompt, params.image_path, params.image_url);
}

/**
 * 分析图表
 */
export async function describe_diagram(
    ctx: SkillContext,
    params: { image_path?: string; image_url?: string; diagram_type?: string }
): Promise<string> {
    ctx.logger.info(`[vision] describe_diagram`);
    const typeHint = params.diagram_type ? `（类型：${params.diagram_type}）` : '';
    const prompt = `请详细分析这张技术图表${typeHint}：
1. 描述图表的整体结构和目的
2. 列出所有主要节点、组件或实体
3. 描述它们之间的关系和数据流向
4. 指出任何重要的设计决策或模式
请用中文回答。`;
    return callVisionLLM(ctx, prompt, params.image_path, params.image_url);
}

export default { analyze_image, ocr, describe_diagram };
