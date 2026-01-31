import { readFile, writeFile, readdir, unlink, copyFile, stat } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';
import type { SkillContext } from '../../../src/types.js';

/**
 * 读取文件内容
 */
export async function read_file(
    ctx: SkillContext,
    params: { path: string; encoding?: BufferEncoding }
): Promise<string> {
    const { path, encoding = 'utf-8' } = params;
    ctx.logger.info(`Reading file: ${path}`);
    return readFile(path, encoding);
}

/**
 * 写入文件
 */
export async function write_file(
    ctx: SkillContext,
    params: { path: string; content: string; append?: boolean }
): Promise<{ success: boolean }> {
    const { path, content, append = false } = params;
    ctx.logger.info(`Writing file: ${path}`);

    if (append) {
        const existing = await readFile(path, 'utf-8').catch(() => '');
        await writeFile(path, existing + content, 'utf-8');
    } else {
        await writeFile(path, content, 'utf-8');
    }

    return { success: true };
}

/**
 * 列出目录内容
 */
export async function list_directory(
    ctx: SkillContext,
    params: { path: string; recursive?: boolean }
): Promise<Array<{ name: string; type: 'file' | 'directory'; size?: number }>> {
    const { path, recursive = false } = params;
    ctx.logger.info(`Listing directory: ${path}`);

    const entries = await readdir(path, { withFileTypes: true });
    const result: Array<{ name: string; type: 'file' | 'directory'; size?: number }> = [];

    for (const entry of entries) {
        const fullPath = join(path, entry.name);
        const stats = await stat(fullPath);

        result.push({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: entry.isFile() ? stats.size : undefined,
        });

        if (recursive && entry.isDirectory()) {
            const subEntries = await list_directory(ctx, { path: fullPath, recursive: true });
            result.push(...subEntries.map(e => ({ ...e, name: join(entry.name, e.name) })));
        }
    }

    return result;
}

/**
 * 搜索文件
 */
export async function search_files(
    ctx: SkillContext,
    params: { pattern: string; cwd?: string }
): Promise<string[]> {
    const { pattern, cwd = process.cwd() } = params;
    ctx.logger.info(`Searching files: ${pattern} in ${cwd}`);
    return glob(pattern, { cwd, absolute: true });
}

/**
 * 删除文件
 */
export async function delete_file(
    ctx: SkillContext,
    params: { path: string }
): Promise<{ success: boolean }> {
    ctx.logger.info(`Deleting file: ${params.path}`);
    await unlink(params.path);
    return { success: true };
}

/**
 * 复制文件
 */
export async function copy_file(
    ctx: SkillContext,
    params: { source: string; destination: string }
): Promise<{ success: boolean }> {
    ctx.logger.info(`Copying file: ${params.source} -> ${params.destination}`);
    await copyFile(params.source, params.destination);
    return { success: true };
}

export default { read_file, write_file, list_directory, search_files, delete_file, copy_file };
