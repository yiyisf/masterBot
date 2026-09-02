import {
  toolGrantId,
  toolRevisionId,
  type SafeToolSummary,
  type ToolProvider,
  type ToolProviderRequest,
  type ToolCatalogProvisioning,
  type ToolProviderResult,
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
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > this.maximumResponseBytes) {
      await response.body?.cancel();
      throw new Error('HTTPS response is too large');
    }
    const body = await readBoundedBody(response, this.maximumResponseBytes);
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

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    totalBytes += item.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new Error('HTTPS response is too large');
    }
    chunks.push(item.value);
  }
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export const WORKFLOW_VALIDATION_TOOL_GRANT_ID = toolGrantId(
  '00000000-0000-4000-8000-000000000011',
);

/** Temporary workflow-validation Catalog tracked for replacement by #103. */
export function workflowValidationToolCatalog(): ToolCatalogProvisioning {
  return {
    revisions: [
      {
        id: toolRevisionId('00000000-0000-4000-8000-000000000008'),
        capabilityId: 'cmaster.utility.current_time:v1',
        name: 'current_time',
        description: 'Returns the current UTC time.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
          type: 'object', required: ['iso'], additionalProperties: false,
          properties: { iso: { type: 'string' } },
        },
        effect: 'read_only', recovery: 'retry_same_call', risks: [],
        providerKey: 'builtin:current-time',
      },
      {
        id: toolRevisionId('00000000-0000-4000-8000-000000000009'),
        capabilityId: 'cmaster.utility.text_statistics:v1',
        name: 'text_statistics',
        description: 'Counts Unicode characters, words, and lines in text.',
        inputSchema: {
          type: 'object', required: ['text'], additionalProperties: false,
          properties: { text: { type: 'string' } },
        },
        outputSchema: {
          type: 'object', required: ['characters', 'words', 'lines'], additionalProperties: false,
          properties: {
            characters: { type: 'integer' }, words: { type: 'integer' }, lines: { type: 'integer' },
          },
        },
        effect: 'read_only', recovery: 'retry_same_call', risks: ['handles_sensitive_data'],
        providerKey: 'builtin:text-statistics',
      },
      {
        id: toolRevisionId('00000000-0000-4000-8000-000000000010'),
        capabilityId: 'cmaster.http.fetch:v1',
        name: 'https_fetch',
        description: 'Fetches one explicitly allowed credential-free HTTPS URL.',
        inputSchema: {
          type: 'object', required: ['url'], additionalProperties: false,
          properties: { url: { type: 'string', format: 'uri' } },
        },
        outputSchema: {
          type: 'object', required: ['status', 'contentType', 'body'], additionalProperties: false,
          properties: {
            status: { type: 'integer' }, contentType: { type: 'string' }, body: { type: 'string' },
          },
        },
        effect: 'read_only', recovery: 'retry_same_call', risks: ['open_world'],
        providerKey: 'builtin:https-fetch',
      },
    ],
    grants: [{
      id: WORKFLOW_VALIDATION_TOOL_GRANT_ID,
      capabilityIds: [
        'cmaster.utility.current_time:v1',
        'cmaster.utility.text_statistics:v1',
        'cmaster.http.fetch:v1',
      ],
    }],
  };
}

function readText(input: unknown): string {
  if (!input || typeof input !== 'object' || !('text' in input)
    || typeof input.text !== 'string') throw new Error('Text is required');
  return input.text;
}
