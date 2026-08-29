import createClient from 'openapi-fetch';
import type { paths } from './generated/openapi.js';

export type ContractClient = ReturnType<typeof createClient<paths>>;

export function createContractClient(baseUrl: string): ContractClient {
  return createClient<paths>({ baseUrl, credentials: 'include' });
}
