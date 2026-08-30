import {
  modelProfileId,
  OpenAICompatibleModelAdapter,
  type ModelProfile,
} from '@cmaster/models';
import type { OrganizationId } from '@cmaster/identity';

const baseUrl = process.env.CMASTER_PRIMARY_MODEL_BASE_URL;
const modelId = process.env.CMASTER_PRIMARY_MODEL_ID;
const apiKey = process.env.CMASTER_PRIMARY_MODEL_API_KEY;

if (!baseUrl || !modelId || !apiKey) {
  console.log('SKIP: real model credentials were not provided');
  process.exit(0);
}

// 这是显式付费 Smoke Eval，仅验证真实 Provider Adapter；完整 Run/ModelCall 语义由 PostgreSQL Regression Eval 覆盖。
const profile: ModelProfile = {
  id: modelProfileId('00000000-0000-4000-8000-000000000006'),
  organizationId: '00000000-0000-4000-8000-000000000001' as OrganizationId,
  displayName: 'Smoke Model',
  routeRole: 'primary',
  providerKind: 'openai-compatible',
  baseUrl,
  providerModelId: modelId,
  credentialRef: 'env:CMASTER_PRIMARY_MODEL_API_KEY',
  capabilities: { streamingText: true },
  dataHandlingTier: 'smoke',
  costTier: 'smoke',
};

let text = '';
let usage: { totalTokens: number } | undefined;
for await (const event of new OpenAICompatibleModelAdapter().stream({
  profile,
  apiKey,
  prompt: 'Reply with exactly: CMaster model smoke passed',
  signal: new AbortController().signal,
})) {
  if (event.type === 'text_delta') text += event.text;
  if (event.type === 'completed') usage = event.usage;
}
if (!text.trim() || !usage) throw new Error('Real model smoke did not return text and usage');
console.log(JSON.stringify({ status: 'passed', model: modelId, outputCharacters: text.length, totalTokens: usage.totalTokens }));
