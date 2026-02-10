import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SkillContext } from '../../../src/types.js';

const execFileAsync = promisify(execFile);

/**
 * 向 Gemini 提问或分析内容
 */
export async function ask(
    ctx: SkillContext,
    params: { prompt: string; cwd?: string; model?: string; files?: string }
): Promise<string> {
    const { prompt, cwd, model, files } = params;
    if (!prompt) return 'Error: prompt parameter is required';

    const args = ['-p', prompt, '--output-format', 'json'];
    if (model) args.push('-m', model);
    if (files) args.push('--include-directories', files);

    ctx.logger.info(`Gemini CLI ask: ${prompt.slice(0, 100)}...`);

    try {
        const { stdout } = await execFileAsync('gemini', args, {
            cwd: cwd || process.cwd(),
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env },
        });

        try {
            const result = JSON.parse(stdout);
            return typeof result.response === 'string' ? result.response : JSON.stringify(result, null, 2);
        } catch {
            // If not valid JSON, return raw output
            return stdout.trim();
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return 'Error: Gemini CLI not found. Please install it first.';
        }
        return `Error: ${error.stderr || error.message}`;
    }
}

/**
 * 分析代码仓库或文件
 */
export async function analyze_code(
    ctx: SkillContext,
    params: { prompt: string; cwd?: string; include_directories?: string }
): Promise<string> {
    const { prompt, cwd, include_directories } = params;
    if (!prompt) return 'Error: prompt parameter is required';

    const args = ['-p', prompt, '--output-format', 'json', '-a'];
    if (include_directories) args.push('--include-directories', include_directories);

    ctx.logger.info(`Gemini CLI analyze_code: ${prompt.slice(0, 100)}...`);

    try {
        const { stdout } = await execFileAsync('gemini', args, {
            cwd: cwd || process.cwd(),
            timeout: 180_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env },
        });

        try {
            const result = JSON.parse(stdout);
            return typeof result.response === 'string' ? result.response : JSON.stringify(result, null, 2);
        } catch {
            return stdout.trim();
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return 'Error: Gemini CLI not found. Please install it first.';
        }
        return `Error: ${error.stderr || error.message}`;
    }
}

/**
 * 使用 Gemini 内置 Google 搜索获取实时信息
 */
export async function search_web(
    ctx: SkillContext,
    params: { query: string }
): Promise<string> {
    const { query } = params;
    if (!query) return 'Error: query parameter is required';

    ctx.logger.info(`Gemini CLI search_web: ${query}`);

    try {
        const { stdout } = await execFileAsync('gemini', [
            '-p', `搜索并总结: ${query}`,
            '--output-format', 'json',
            '-y',
        ], {
            timeout: 60_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env },
        });

        try {
            const result = JSON.parse(stdout);
            return typeof result.response === 'string' ? result.response : JSON.stringify(result, null, 2);
        } catch {
            return stdout.trim();
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return 'Error: Gemini CLI not found. Please install it first.';
        }
        return `Error: ${error.stderr || error.message}`;
    }
}

export default { ask, analyze_code, search_web };
