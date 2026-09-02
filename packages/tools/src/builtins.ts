import type {
  SafeToolSummary,
  ToolProvider,
  ToolProviderRequest,
  ToolProviderResult,
} from './types.js';

export class CurrentTimeToolProvider implements ToolProvider {
  readonly key = 'builtin:current-time';

  constructor(private readonly now: () => Date = () => new Date()) {}

  summarize(): SafeToolSummary {
    return { title: 'Read current UTC time', details: { operation: 'read-only' } };
  }

  async execute(): Promise<ToolProviderResult> {
    return {
      kind: 'success',
      value: { iso: this.now().toISOString() },
      safeSummary: { title: 'Current UTC time read', details: { operation: 'read-only' } },
    };
  }
}

export class TextStatisticsToolProvider implements ToolProvider {
  readonly key = 'builtin:text-statistics';

  summarize(input: unknown): SafeToolSummary {
    const text = readText(input);
    return {
      title: 'Calculate text statistics',
      details: { characterCount: String([...text].length) },
    };
  }

  async execute(request: ToolProviderRequest): Promise<ToolProviderResult> {
    const text = readText(request.input);
    const words = text.trim().length === 0 ? [] : text.trim().split(/\s+/u);
    return {
      kind: 'success',
      value: {
        characters: [...text].length,
        words: words.length,
        lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/u).length,
      },
      safeSummary: {
        title: 'Text statistics calculated',
        details: { characterCount: String([...text].length) },
      },
    };
  }
}

export interface HttpsFetchToolProviderOptions {
  allowedHosts: readonly string[];
  timeoutMs?: number;
  maximumResponseBytes?: number;
  fetch?: typeof fetch;
}

export class HttpsFetchToolProvider implements ToolProvider {
  readonly key = 'builtin:https-fetch';
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: HttpsFetchToolProviderOptions) {
    this.allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maximumResponseBytes = options.maximumResponseBytes ?? 64 * 1024;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  summarize(input: unknown): SafeToolSummary {
    const url = this.validateUrl(input);
    return { title: 'Fetch approved HTTPS resource', details: { host: url.hostname } };
  }

  async execute(request: ToolProviderRequest): Promise<ToolProviderResult> {
    const url = this.validateUrl(request.input);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([request.signal, timeout]);
    const response = await this.fetchImplementation(url, {
      method: 'GET',
      redirect: 'error',
      signal,
      headers: { accept: 'text/plain, application/json' },
    });
    if (!response.ok) throw new Error('Approved HTTPS resource returned an error');
    const body = await response.arrayBuffer();
    if (body.byteLength > this.maximumResponseBytes) throw new Error('HTTPS response is too large');
    return {
      kind: 'success',
      value: {
        status: response.status,
        contentType: response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream',
        body: new TextDecoder().decode(body),
      },
      safeSummary: {
        title: 'Approved HTTPS resource fetched',
        details: { host: url.hostname, status: String(response.status) },
      },
    };
  }

  private validateUrl(input: unknown): URL {
    if (!input || typeof input !== 'object' || !('url' in input)
      || typeof input.url !== 'string') throw new Error('A URL is required');
    const url = new URL(input.url);
    if (url.protocol !== 'https:' || url.username || url.password
      || url.port || url.hash || !this.allowedHosts.has(url.hostname.toLowerCase())) {
      throw new Error('HTTPS host is not allowed');
    }
    return url;
  }
}

function readText(input: unknown): string {
  if (!input || typeof input !== 'object' || !('text' in input)
    || typeof input.text !== 'string') throw new Error('Text is required');
  return input.text;
}
