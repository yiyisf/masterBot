import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);
const { systemStatusSchema } = await import('../src/system-status.js');
const registry = new OpenAPIRegistry();

const systemStatusContract = registry.register('SystemStatus', systemStatusSchema);
registry.registerPath({
  method: 'get',
  path: '/api/v1/system/status',
  summary: 'Read the next-architecture system status',
  responses: {
    200: {
      description: 'Current non-sensitive service status',
      content: {
        'application/json': {
          schema: systemStatusContract,
        },
      },
    },
  },
});

const generator = new OpenApiGeneratorV31(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'CMaster Bot API',
    version: '1.0.0',
  },
});

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(packageRoot, 'openapi/openapi.v1.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
