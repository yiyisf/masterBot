import type { OrganizationId, PrincipalId, RequestIdentity } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';

export type ApprovalId = Brand<string, 'ApprovalId'>;
export type ApprovalCommandId = Brand<string, 'ApprovalCommandId'>;

export interface ToolApprovalSubject {
  kind: 'tool_call';
  subjectRef: string;
  toolRevisionRef: string;
  requestHash: string;
  safeSummary: {
    title: string;
    details: Readonly<Record<string, string>>;
  };
}

export interface Approval {
  id: ApprovalId;
  organizationId: OrganizationId;
  initiatingPrincipalId: PrincipalId;
  subject: ToolApprovalSubject;
  policyVersion: string;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: Date;
  resolvedAt?: Date;
}

export interface RequestApprovalCommand {
  commandId: ApprovalCommandId;
  subject: ToolApprovalSubject;
  policyVersion: string;
}

export interface ResolveApprovalCommand {
  commandId: ApprovalCommandId;
  response: 'confirm' | 'reject';
}

export interface CommandResult<Value> {
  value: Value;
  replayed: boolean;
}

/**
 * Owns Employee Confirmation records for immutable Approval Subjects.
 * Commands are Organization-scoped and idempotent; conflicting command reuse is rejected.
 */
export interface ApprovalModule {
  request(identity: RequestIdentity, command: RequestApprovalCommand): Promise<CommandResult<Approval>>;
  resolve(
    identity: RequestIdentity,
    approvalId: ApprovalId,
    command: ResolveApprovalCommand,
  ): Promise<CommandResult<Approval>>;
}

export class ApprovalIdempotencyConflictError extends Error {}
export class ApprovalNotFoundError extends Error {}
export class ApprovalAlreadyResolvedError extends Error {}

export function approvalCommandId(value: string): ApprovalCommandId {
  return value as ApprovalCommandId;
}
