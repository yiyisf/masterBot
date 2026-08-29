import { z } from 'zod';

export const serverRoleSchema = z.enum(['api', 'worker', 'all']);
export type ServerRole = z.infer<typeof serverRoleSchema>;

export const systemStatusSchema = z.object({
  contractVersion: z.literal('v1'),
  service: z.literal('cmaster-next'),
  role: serverRoleSchema,
  status: z.enum(['ok', 'degraded']),
  postgres: z.enum(['available', 'unavailable']),
  nextArchitectureEnabled: z.boolean(),
});

export type SystemStatus = z.infer<typeof systemStatusSchema>;
