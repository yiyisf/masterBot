import { randomUUID } from 'node:crypto';
import type {
  CredentialBroker,
  CredentialLease,
  IssueCredentialLeaseCommand,
} from './types.js';

/**
 * Development-only broker for credential-free Built-in Tools. It still issues a bounded,
 * operation-scoped lease so Tool Providers cannot introduce a plaintext credential assumption.
 */
export class DevelopmentCredentialBroker implements CredentialBroker {
  constructor(private readonly lifetimeMs = 60_000) {}

  async issue(command: IssueCredentialLeaseCommand): Promise<CredentialLease> {
    return {
      id: randomUUID() as CredentialLease['id'],
      organizationId: command.identity.organizationId,
      principalId: command.identity.principalId,
      toolCallId: command.toolCallId,
      invocationId: command.invocationId,
      allowedOperations: [...command.allowedOperations],
      expiresAt: new Date(Date.now() + this.lifetimeMs),
      values: {},
    };
  }

  async revoke(): Promise<void> {
    // Development Built-ins receive no values; the method preserves the production lease lifecycle seam.
  }
}
