import type { SkillContext } from '../../../src/types.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { extname } from 'path';

/**
 * 读取 PDF 文件
 */
export async function read_pdf(
    ctx: SkillContext,
    params: { path: string }
): Promise<string> {
    ctx.logger.info(`[document-processor] read_pdf: ${params.path}`);

    if (!existsSync(params.path)) {
        throw new Error(`文件不存在: ${params.path}`);
    }

    let pdfParse: typeof import('pdf-parse');
    try {
        pdfParse = await import('pdf-parse');
    } catch {
        throw new Error('pdf-parse 未安装，请运行 npm install pdf-parse');
    }

    const buffer = readFileSync(params.path);
    const data = await pdfParse.default(buffer);
    return `PDF 文本内容（共 ${data.numpages} 页）:\n\n${data.text}`;
}

/**
 * 读取 DOCX 文件
 */
export async function read_docx(
    ctx: SkillContext,
    params: { path: string; format?: 'text' | 'markdown' }
): Promise<string> {
    ctx.logger.info(`[document-processor] read_docx: ${params.path}`);
    const { path: filePath, format = 'markdown' } = params;

    if (!existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }

    let mammoth: typeof import('mammoth');
    try {
        mammoth = await import('mammoth');
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
    ctx.logger.info(`[document-processor] read_xlsx: ${params.path}`);
    const { path: filePath, max_rows = 100 } = params;

    if (!existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }

    let XLSX: typeof import('xlsx');
    try {
        XLSX = await import('xlsx');
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
    ctx.logger.info(`[document-processor] write_xlsx: ${params.path}`);
    const { path: filePath, data, sheet = 'Sheet1' } = params;

    let XLSX: typeof import('xlsx');
    try {
        XLSX = await import('xlsx');
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
    ctx.logger.info(`[document-processor] convert_to_markdown: ${params.path}`);
    const { path: filePath, output_path } = params;

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

    if (output_path) {
        writeFileSync(output_path, content, 'utf-8');
        return `Markdown 已保存到: ${output_path}`;
    }

    return content;
}

export default { read_pdf, read_docx, read_xlsx, write_xlsx, convert_to_markdown };
