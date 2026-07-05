import { resolve, sep } from 'path';
import type { SkillContext } from '../../../src/types.js';
import { expandPath, resolveCliCommand, spawnCli } from '#skill-kit/skills/utils.js';

/**
 * P1-2: 与 claude-code skill 的治理边界保持一致 —— 子进程内部的工具调用不受
 * CMaster 沙箱/Hook 管辖，cwd 收敛到项目根目录内，禁止越权访问。
 */
function resolveSafeCwd(rawCwd?: string): string {
    const root = resolve(process.cwd());
    if (!rawCwd) return root;
    const resolved = expandPath(rawCwd);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
        throw new Error(`cwd 必须位于项目根目录内 (${root})，拒绝越权路径: ${resolved}`);
    }
    return resolved;
}

function parseGeminiOutput(raw: string): string {
    try {
        const result = JSON.parse(raw);
        return typeof result.response === 'string' ? result.response : JSON.stringify(result, null, 2);
    } catch {
        return raw.trim();
    }
}

/**
 * 向 Gemini 提问或分析内容
 */
export async function ask(
    ctx: SkillContext,
    params: { prompt: string; cwd?: string; model?: string; files?: string }
): Promise<string> {
    const { prompt, model, files } = params;
    if (!prompt) return 'Error: prompt parameter is required';

    let safeCwd: string;
    try {
        safeCwd = resolveSafeCwd(params.cwd);
    } catch (error: any) {
        return `Error: ${error.message}`;
    }

    const args = ['-p', prompt, '--output-format', 'json'];
    if (model) args.push('-m', model);
    if (files) args.push('--include-directories', files);

    ctx.logger.info(`Gemini CLI ask: ${prompt.slice(0, 100)}...`);

    try {
        const raw = await spawnCli(resolveCliCommand('gemini'), args, {
            cwd: safeCwd,
            timeout: 120_000,
        });
        return parseGeminiOutput(raw);
    } catch (error: any) {
        return `Error: ${error.message}`;
    }
}

/**
 * 分析代码仓库或文件
 */
export async function analyze_code(
    ctx: SkillContext,
    params: { prompt: string; cwd?: string; include_directories?: string }
): Promise<string> {
    const { prompt, include_directories } = params;
    if (!prompt) return 'Error: prompt parameter is required';

    let safeCwd: string;
    try {
        safeCwd = resolveSafeCwd(params.cwd);
    } catch (error: any) {
        return `Error: ${error.message}`;
    }

    const args = ['-p', prompt, '--output-format', 'json', '-a'];
    if (include_directories) args.push('--include-directories', include_directories);

    ctx.logger.info(`Gemini CLI analyze_code: ${prompt.slice(0, 100)}...`);

    try {
        const raw = await spawnCli(resolveCliCommand('gemini'), args, {
            cwd: safeCwd,
            timeout: 180_000,
        });
        return parseGeminiOutput(raw);
    } catch (error: any) {
        return `Error: ${error.message}`;
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
        const raw = await spawnCli(resolveCliCommand('gemini'), [
            '-p', `搜索并总结: ${query}`,
            '--output-format', 'json',
            '-y',
        ], {
            timeout: 60_000,
        });
        return parseGeminiOutput(raw);
    } catch (error: any) {
        return `Error: ${error.message}`;
    }
}

export default { ask, analyze_code, search_web };
