/**
 * Browser Automation skill — Playwright-based RPA
 * Cross-platform: Windows uses Edge, macOS/Linux uses Chrome
 * Requires: npm install playwright && npx playwright install msedge chromium
 */
import { platform, homedir } from 'os';
import { join, resolve } from 'path';
import type { SkillContext } from '../../../src/types.js';

// Singleton browser instance per skill context
let browserInstance: any = null;
let pageInstance: any = null;

function resolvePath(rawPath: string): string {
    if (rawPath.startsWith('~')) {
        rawPath = join(homedir(), rawPath.slice(1));
    }
    return resolve(rawPath);
}

async function getPage(ctx: SkillContext): Promise<any> {
    if (pageInstance) return pageInstance;

    ctx.logger.info('[browser-automation] Launching browser...');

    try {
        const { chromium } = await import('playwright');
        const os = platform();

        // Platform-specific browser selection
        const launchOptions: any = {
            headless: false,  // Show browser for user confirmation flow
            slowMo: 100,     // Slight delay for visibility
        };

        if (os === 'win32') {
            // Windows: prefer Edge (pre-installed)
            launchOptions.channel = 'msedge';
            ctx.logger.info('[browser-automation] Using Microsoft Edge (Windows)');
        } else {
            // macOS/Linux: prefer Chrome
            launchOptions.channel = 'chrome';
            ctx.logger.info('[browser-automation] Using Google Chrome (macOS/Linux)');
        }

        try {
            browserInstance = await chromium.launch(launchOptions);
        } catch {
            // Fallback to default Chromium if channel not available
            ctx.logger.warn('[browser-automation] Preferred browser not found, falling back to Chromium');
            browserInstance = await chromium.launch({ headless: false });
        }

        const context = await browserInstance.newContext({
            viewport: { width: 1280, height: 800 },
        });
        pageInstance = await context.newPage();

        return pageInstance;
    } catch (err: any) {
        if (err.message?.includes('Cannot find module')) {
            throw new Error('Playwright not installed. Run: npm install playwright && npx playwright install chromium');
        }
        throw err;
    }
}

function encodeScreenshot(buffer: Buffer): string {
    return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Take a screenshot
 */
export async function screenshot(
    ctx: SkillContext,
    params: { url?: string; selector?: string; fullPage?: boolean }
): Promise<{ screenshot: string; width: number; height: number; url: string }> {
    const page = await getPage(ctx);

    if (params.url) {
        ctx.logger.info(`[browser-automation] Navigating to ${params.url}`);
        await page.goto(params.url, { waitUntil: 'load', timeout: 30000 });
    }

    let buffer: Buffer;
    if (params.selector) {
        const element = await page.$(params.selector);
        if (!element) throw new Error(`Element not found: ${params.selector}`);
        buffer = await element.screenshot();
    } else {
        buffer = await page.screenshot({ fullPage: params.fullPage || false });
    }

    const viewport = page.viewportSize();
    const currentUrl = page.url();

    ctx.logger.info(`[browser-automation] Screenshot captured (${viewport?.width}x${viewport?.height})`);

    return {
        screenshot: encodeScreenshot(buffer),
        width: viewport?.width || 1280,
        height: viewport?.height || 800,
        url: currentUrl,
    };
}

/**
 * Navigate to URL
 */
export async function navigate(
    ctx: SkillContext,
    params: { url: string; waitFor?: 'load' | 'domcontentloaded' | 'networkidle' }
): Promise<{ success: boolean; url: string; title: string }> {
    const page = await getPage(ctx);

    ctx.logger.info(`[browser-automation] Navigating to ${params.url}`);
    await page.goto(params.url, {
        waitUntil: params.waitFor || 'load',
        timeout: 30000,
    });

    const title = await page.title();
    const currentUrl = page.url();

    return { success: true, url: currentUrl, title };
}

/**
 * Click an element
 */
export async function click(
    ctx: SkillContext,
    params: { selector?: string; text?: string; coordinate?: { x: number; y: number } }
): Promise<{ success: boolean; element?: string }> {
    const page = await getPage(ctx);

    if (params.coordinate) {
        ctx.logger.info(`[browser-automation] Clicking at (${params.coordinate.x}, ${params.coordinate.y})`);
        await page.mouse.click(params.coordinate.x, params.coordinate.y);
        return { success: true };
    }

    if (params.text) {
        ctx.logger.info(`[browser-automation] Clicking element with text: "${params.text}"`);
        await page.getByText(params.text, { exact: false }).first().click({ timeout: 10000 });
        return { success: true, element: `text="${params.text}"` };
    }

    if (params.selector) {
        ctx.logger.info(`[browser-automation] Clicking: ${params.selector}`);
        await page.click(params.selector, { timeout: 10000 });
        return { success: true, element: params.selector };
    }

    throw new Error('Provide selector, text, or coordinate');
}

/**
 * Type text into an input
 */
export async function type(
    ctx: SkillContext,
    params: { selector: string; text: string; clear?: boolean }
): Promise<{ success: boolean; selector: string }> {
    const page = await getPage(ctx);

    ctx.logger.info(`[browser-automation] Typing into ${params.selector}`);

    if (params.clear !== false) {
        await page.fill(params.selector, '', { timeout: 10000 });
    }
    await page.type(params.selector, params.text, { delay: 50 });

    return { success: true, selector: params.selector };
}

/**
 * Upload a file to a file input
 */
export async function upload_file(
    ctx: SkillContext,
    params: { selector: string; filePath: string }
): Promise<{ success: boolean; filePath: string }> {
    const page = await getPage(ctx);
    const resolvedPath = resolvePath(params.filePath);

    ctx.logger.info(`[browser-automation] Uploading ${resolvedPath} to ${params.selector}`);

    const fileInput = await page.$(params.selector);
    if (!fileInput) throw new Error(`File input not found: ${params.selector}`);

    await fileInput.setInputFiles(resolvedPath);

    return { success: true, filePath: resolvedPath };
}

/**
 * Extract table data from the page
 */
export async function extract_table(
    ctx: SkillContext,
    params: { selector?: string; headers?: boolean }
): Promise<{ headers: string[]; rows: string[][]; rowCount: number }> {
    const page = await getPage(ctx);
    const tableSelector = params.selector || 'table';

    ctx.logger.info(`[browser-automation] Extracting table: ${tableSelector}`);

    const tableData = await page.evaluate(({ sel, includeHeaders }: { sel: string; includeHeaders: boolean }) => {
        const table = document.querySelector(sel) as HTMLTableElement | null;
        if (!table) return { headers: [], rows: [] };

        const headers: string[] = [];
        const rows: string[][] = [];

        if (includeHeaders) {
            const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
            if (headerRow) {
                headerRow.querySelectorAll('th, td').forEach(cell => {
                    headers.push((cell.textContent || '').trim());
                });
            }
        }

        const bodyRows = table.querySelectorAll('tbody tr, tr');
        bodyRows.forEach((row, i) => {
            if (i === 0 && includeHeaders && headers.length > 0) return;
            const cells: string[] = [];
            row.querySelectorAll('td, th').forEach(cell => {
                cells.push((cell.textContent || '').trim());
            });
            if (cells.length > 0) rows.push(cells);
        });

        return { headers, rows };
    }, { sel: tableSelector, includeHeaders: params.headers !== false });

    return {
        headers: tableData.headers,
        rows: tableData.rows,
        rowCount: tableData.rows.length,
    };
}

/**
 * Close the browser instance
 */
export async function close_browser(
    ctx: SkillContext,
    _params: Record<string, never>
): Promise<{ success: boolean }> {
    if (browserInstance) {
        ctx.logger.info('[browser-automation] Closing browser');
        await browserInstance.close();
        browserInstance = null;
        pageInstance = null;
    }
    return { success: true };
}

export default { screenshot, navigate, click, type, upload_file, extract_table, close_browser };
