import type { SkillContext } from '../../../src/types.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { extname, join, resolve } from 'path';
import { homedir } from 'os';
import { createRequire } from 'module';

// Use createRequire for CJS packages to avoid ESM double-wrapping issues
const _require = createRequire(import.meta.url);

/** 展开 ~ 并解析为绝对路径 */
function expandPath(p: unknown): string {
    if (!p || typeof p !== 'string') {
        throw new Error(`缺少必要参数 path：请提供文件路径`);
    }
    if (p.startsWith('~/') || p === '~') {
        return resolve(join(homedir(), p.slice(1)));
    }
    return resolve(p);
}

/**
 * 读取 PDF 文件
 */
export async function read_pdf(
    ctx: SkillContext,
    params: { path: string }
): Promise<string> {
    const filePath = expandPath(params.path);
    ctx.logger.info(`[document-processor] read_pdf: ${filePath}`);

    if (!existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }

    let PDFParseClass: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string; total: number }> };
    try {
        const mod = _require('pdf-parse');
        // v2: module.exports = { PDFParse (class), ... }
        // v1: module.exports = function(buffer) (plain function, no longer published)
        PDFParseClass = mod.PDFParse ?? mod.default ?? mod;
        if (typeof PDFParseClass !== 'function') throw new Error('no callable export');
    } catch (e: any) {
        if (e.code === 'MODULE_NOT_FOUND') throw new Error('pdf-parse 未安装，请运行 npm install pdf-parse');
        throw e;
    }

    const buffer = readFileSync(filePath);
    const parser = new PDFParseClass({ data: buffer });
    const data = await parser.getText();
    return `PDF 文本内容（共 ${data.total} 页）:\n\n${data.text}`;
}

/**
 * 读取 DOCX 文件
 */
export async function read_docx(
    ctx: SkillContext,
    params: { path: string; format?: 'text' | 'markdown' }
): Promise<string> {
    const { path: rawPath, format = 'markdown' } = params;
    const filePath = expandPath(rawPath);
    ctx.logger.info(`[document-processor] read_docx: ${filePath}`);

    if (!existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }

    let mammoth: typeof import('mammoth');
    try {
        mammoth = _require('mammoth');
    } catch {
        throw new Error('mammoth 未安装，请运行 npm install mammoth');
    }

    const buffer = readFileSync(filePath);
    if (format === 'markdown') {
        const result = await mammoth.convertToMarkdown({ buffer });
        return result.value;
    } else {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
    }
}

/**
 * 读取 Excel 文件
 */
export async function read_xlsx(
    ctx: SkillContext,
    params: { path: string; sheet?: string; max_rows?: number }
): Promise<string> {
    const { path: rawPath, max_rows = 100 } = params;
    const filePath = expandPath(rawPath);
    ctx.logger.info(`[document-processor] read_xlsx: ${filePath}`);

    if (!existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }

    let XLSX: typeof import('xlsx');
    try {
        XLSX = _require('xlsx');
    } catch {
        throw new Error('xlsx 未安装，请运行 npm install xlsx');
    }

    const workbook = XLSX.readFile(filePath);
    const sheetName = params.sheet || workbook.SheetNames[0];

    if (!workbook.SheetNames.includes(sheetName)) {
        throw new Error(`工作表 "${sheetName}" 不存在。可用工作表: ${workbook.SheetNames.join(', ')}`);
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
    const limited = rows.slice(0, max_rows);

    if (limited.length === 0) {
        return `工作表 "${sheetName}" 为空`;
    }

    // Format as markdown table
    const headers = Object.keys(limited[0]);
    const headerRow = `| ${headers.join(' | ')} |`;
    const separator = `| ${headers.map(() => '---').join(' | ')} |`;
    const dataRows = limited.map(row => `| ${headers.map(h => String(row[h] ?? '')).join(' | ')} |`);

    return `工作表: ${sheetName}（${rows.length} 行，显示前 ${limited.length} 行）\n\n${headerRow}\n${separator}\n${dataRows.join('\n')}`;
}

/**
 * 写入 Excel 文件
 */
export async function write_xlsx(
    ctx: SkillContext,
    params: { path: string; data: Record<string, unknown>[]; sheet?: string }
): Promise<string> {
    const { path: rawPath, data, sheet = 'Sheet1' } = params;
    const filePath = expandPath(rawPath);
    ctx.logger.info(`[document-processor] write_xlsx: ${filePath}`);

    let XLSX: typeof import('xlsx');
    try {
        XLSX = _require('xlsx');
    } catch {
        throw new Error('xlsx 未安装，请运行 npm install xlsx');
    }

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet);
    XLSX.writeFile(workbook, filePath);

    return `Excel 文件已写入: ${filePath}（${data.length} 行数据）`;
}

/**
 * 转换文档为 Markdown
 */
export async function convert_to_markdown(
    ctx: SkillContext,
    params: { path: string; output_path?: string }
): Promise<string> {
    const { path: rawPath, output_path: rawOutputPath } = params;
    const filePath = expandPath(rawPath);
    ctx.logger.info(`[document-processor] convert_to_markdown: ${filePath}`);

    if (!existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }

    const ext = extname(filePath).toLowerCase();
    let content: string;

    if (ext === '.pdf') {
        content = await read_pdf(ctx, { path: filePath });
    } else if (ext === '.docx') {
        content = await read_docx(ctx, { path: filePath, format: 'markdown' });
    } else {
        throw new Error(`不支持的文件格式: ${ext}。支持 .pdf 和 .docx`);
    }

    if (rawOutputPath) {
        const outputPath = expandPath(rawOutputPath);
        writeFileSync(outputPath, content, 'utf-8');
        return `Markdown 已保存到: ${outputPath}`;
    }

    return content;
}

export default { read_pdf, read_docx, read_xlsx, write_xlsx, convert_to_markdown };
