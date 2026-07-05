import type { SkillContext } from '../../../src/types.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { extname } from 'path';
import { createRequire } from 'module';
import { expandPath } from '#skill-kit/skills/utils.js';
import type { CellValue } from 'exceljs';

// Use createRequire for CJS packages to avoid ESM double-wrapping issues
const _require = createRequire(import.meta.url);

/** 单次读取最多允许的字符数，超出时截断并提示 */
const PDF_MAX_CHARS = 40_000;

/**
 * 读取 PDF 文件
 */
export async function read_pdf(
    ctx: SkillContext,
    params: {
        path: string;
        /** 起始页码（从 1 开始），默认 1 */
        start_page?: number;
        /** 结束页码（含），默认读取到 start_page + max_pages - 1 */
        end_page?: number;
        /** 最多读取页数，默认 50。与 end_page 同时指定时取较小范围 */
        max_pages?: number;
    }
): Promise<string> {
    const { path: rawPath, start_page = 1, max_pages = 50 } = params;
    const filePath = expandPath(rawPath);
    ctx.logger.info(`[document-processor] read_pdf: ${filePath}`);

    if (!existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }

    let PDFParseClass: new (opts: { data: Buffer }) => {
        getText(opts?: { first?: number; last?: number }): Promise<{ text: string; total: number }>;
        destroy(): Promise<void>;
    };
    try {
        const mod = _require('pdf-parse');
        // v2: module.exports = { PDFParse (class), ... }
        PDFParseClass = mod.PDFParse ?? mod.default ?? mod;
        if (typeof PDFParseClass !== 'function') throw new Error('no callable export');
    } catch (e: any) {
        if (e.code === 'MODULE_NOT_FOUND') throw new Error('pdf-parse 未安装，请运行 npm install pdf-parse');
        throw e;
    }

    // Determine page range before parsing (use conservative defaults; total will be validated after)
    const first = Math.max(1, start_page);
    const lastByMaxPages = first + max_pages - 1;
    const requestedLast = params.end_page !== undefined
        ? Math.min(params.end_page, lastByMaxPages)
        : lastByMaxPages;

    const buffer = readFileSync(filePath);
    const parser = new PDFParseClass({ data: buffer });

    // Single getText call — total page count is available in the result
    const data = await parser.getText({ first, last: requestedLast });
    await parser.destroy?.();

    const totalPages = data.total;
    // Clamp last to actual total (pdf-parse already clamps, but we need it for display)
    const last = Math.min(requestedLast, totalPages);

    ctx.logger.info(`[document-processor] read_pdf: pages ${first}-${last} of ${totalPages}`);

    const rangeNote = (first > 1 || last < totalPages)
        ? `（第 ${first}-${last} 页，共 ${totalPages} 页`
        : `（共 ${totalPages} 页`;

    const originalLength = data.text.length;
    let text = data.text;
    let truncNote = '';
    if (originalLength > PDF_MAX_CHARS) {
        text = text.slice(0, PDF_MAX_CHARS);
        truncNote = `\n\n[内容已截断：显示前 ${PDF_MAX_CHARS} 字符，实际共 ${originalLength} 字符。请缩小页码范围或减少 max_pages]`;
    }

    const remainNote = last < totalPages
        ? `，剩余 ${totalPages - last} 页未读取，可通过 start_page=${last + 1} 继续）`
        : '）';

    return `PDF 文本内容${rangeNote}${remainNote}:\n\n${text}${truncNote}`;
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

/** 将单元格值转为可展示的字符串（日期/公式结果/富文本做特殊处理） */
function cellToDisplay(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
        const v = value as Record<string, unknown>;
        if ('result' in v) return String(v.result ?? '');
        if (Array.isArray(v.richText)) {
            return (v.richText as Array<{ text?: string }>).map(t => t.text ?? '').join('');
        }
        if (typeof v.text === 'string') return v.text; // hyperlink 单元格
        return JSON.stringify(v);
    }
    return String(value);
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

    let ExcelJS: typeof import('exceljs');
    try {
        ExcelJS = _require('exceljs');
    } catch {
        throw new Error('exceljs 未安装，请运行 npm install exceljs');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheetNames = workbook.worksheets.map(ws => ws.name);
    const worksheet = params.sheet ? workbook.getWorksheet(params.sheet) : workbook.worksheets[0];

    if (!worksheet) {
        throw new Error(`工作表 "${params.sheet}" 不存在。可用工作表: ${sheetNames.join(', ')}`);
    }

    const colCount = worksheet.columnCount || worksheet.getRow(1).cellCount;
    const headers: string[] = [];
    for (let c = 1; c <= colCount; c++) {
        const val = worksheet.getRow(1).getCell(c).value;
        headers.push(val === null || val === undefined ? `col${c}` : cellToDisplay(val));
    }

    const totalDataRows = Math.max(0, worksheet.rowCount - 1);
    const rows: Record<string, unknown>[] = [];
    // 只遍历到 max_rows 即可停止，避免超大表格为丢弃的行做无谓的单元格读取
    const lastRowToRead = Math.min(worksheet.rowCount, 1 + max_rows);
    for (let r = 2; r <= lastRowToRead; r++) {
        const row = worksheet.getRow(r);
        const obj: Record<string, unknown> = {};
        headers.forEach((h, idx) => {
            obj[h] = row.getCell(idx + 1).value;
        });
        rows.push(obj);
    }

    const limited = rows.slice(0, max_rows);

    if (limited.length === 0) {
        return `工作表 "${worksheet.name}" 为空`;
    }

    // Format as markdown table
    const headerRow = `| ${headers.join(' | ')} |`;
    const separator = `| ${headers.map(() => '---').join(' | ')} |`;
    const dataRows = limited.map(row => `| ${headers.map(h => cellToDisplay(row[h])).join(' | ')} |`);

    return `工作表: ${worksheet.name}（${totalDataRows} 行，显示前 ${limited.length} 行）\n\n${headerRow}\n${separator}\n${dataRows.join('\n')}`;
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

    let ExcelJS: typeof import('exceljs');
    try {
        ExcelJS = _require('exceljs');
    } catch {
        throw new Error('exceljs 未安装，请运行 npm install exceljs');
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheet);

    if (data.length > 0) {
        const headers = Object.keys(data[0]);
        worksheet.addRow(headers);
        for (const row of data) {
            worksheet.addRow(headers.map(h => (row[h] ?? '') as CellValue));
        }
    }

    await workbook.xlsx.writeFile(filePath);

    return `Excel 文件已写入: ${filePath}（${data.length} 行数据）`;
}

/**
 * 转换文档为 Markdown
 */
export async function convert_to_markdown(
    ctx: SkillContext,
    params: { path: string; output_path?: string; start_page?: number; end_page?: number; max_pages?: number }
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
        content = await read_pdf(ctx, { path: filePath, start_page: params.start_page, end_page: params.end_page, max_pages: params.max_pages });
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
