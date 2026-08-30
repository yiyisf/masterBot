import type { OrganizationId } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';

export type ToolRevisionId = Brand<string, 'ToolRevisionId'>;
export type ToolGrantId = Brand<string, 'ToolGrantId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;

export type ToolEffect = 'read_only' | 'idempotent_write' | 'non_idempotent_write';
export type ToolRecovery = 'retry_same_call' | 'idempotency_key' | 'reconcile' | 'manual_review';
export type ToolRisk = 'destructive' | 'open_world' | 'handles_sensitive_data';
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolDescriptor {
  revisionId: ToolRevisionId;
  capabilityId: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  effect: ToolEffect;
  recovery: ToolRecovery;
  risks: readonly ToolRisk[];
}

export interface ToolRevisionProvisioning extends Omit<ToolDescriptor, 'revisionId'> {
  id: ToolRevisionId;
  providerKey: string;
}

export interface ToolGrantProvisioning {
  id: ToolGrantId;
  capabilityIds: readonly string[];
}

export interface ToolCatalogProvisioning {
  revisions: readonly ToolRevisionProvisioning[];
  grants: readonly ToolGrantProvisioning[];
}

export interface ListGrantedTools {
  organizationId: OrganizationId;
  grantId: ToolGrantId;
}

/**
 * Owns immutable Tool Capability/Revision metadata and Agent Tool Grants.
 * list returns only active Revisions in the requested Organization and grant, ordered by Capability ID.
 */
export interface ToolCatalog {
  provision(organizationId: OrganizationId, input: ToolCatalogProvisioning): Promise<void>;
  list(query: ListGrantedTools): Promise<ToolDescriptor[]>;
}

export class ToolProvisioningConflictError extends Error {}

export function toolRevisionId(value: string): ToolRevisionId {
  return value as ToolRevisionId;
}

export function toolGrantId(value: string): ToolGrantId {
  return value as ToolGrantId;
}
