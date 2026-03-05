import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { GatewayServer } from '../src/gateway/server.js';

vi.mock('../src/core/database.js', () => {
    return {
        db: {
            prepare: (sql: string) => {
                return {
                    all: () => {
                        if (sql.includes('FROM conductor_workflows ORDER BY updated_at DESC')) {
                            return [{ id: 'w1', name: 'Test', description: null, version: 1, definition: '{"name":"Test"}', created_at: '2023-01-01', updated_at: '2023-01-01' }];
                        }
                        return [];
                    },
                    get: (param?: any) => {
                        if (sql.includes('FROM conductor_workflows WHERE id = ?')) {
                            if (param === 'w1') return { id: 'w1', name: 'Test', description: null, version: 1, definition: '{"name":"Test"}', created_at: '2023-01-01', updated_at: '2023-01-01' };
                        }
                        if (sql.includes('SELECT id FROM conductor_workflows WHERE id = ?')) {
                            if (param === 'w1') return { id: 'w1' };
                        }
                        return null;
                    },
                    run: (...params: any[]) => {
                        return { changes: 1 };
                    }
                };
            }
        }
    };
});

describe('Conductor Workflows API', () => {
    let server: GatewayServer;

    beforeAll(async () => {
        server = new GatewayServer({
            config: { logging: { prettyPrint: false, level: 'silent' }, server: { host: 'localhost', port: 0 } },
            db: {} as any,
            logger: { info: () => { }, error: () => { }, debug: () => { }, warn: () => { } } as any,
            agent: { getSkillRegistry: () => ({ searchTools: () => [], getToolDefinitions: () => [] }) } as any,
            sessionManager: {} as any
        } as any);
        await server.start(0, '127.0.0.1');
    });

    afterAll(async () => {
        if (server) await server.stop();
    });

    it('should list conductor workflows', async () => {
        const response = await server['app'].inject({
            method: 'GET',
            url: '/api/conductor-workflows',
        });
        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(Array.isArray(data)).toBe(true);
        expect(data[0].id).toBe('w1');
    });

    it('should get a specific conductor workflow', async () => {
        const response = await server['app'].inject({
            method: 'GET',
            url: '/api/conductor-workflows/w1',
        });
        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(data.id).toBe('w1');
    });

    it('should create a new conductor workflow', async () => {
        const response = await server['app'].inject({
            method: 'POST',
            url: '/api/conductor-workflows',
            payload: {
                name: 'New Workflow',
                version: 1,
                definition: { name: 'New Workflow', tasks: [] }
            }
        });
        expect(response.statusCode).toBe(200);
        const data = JSON.parse(response.payload);
        expect(data.id).toBeDefined();
    });

    it('should update an existing conductor workflow', async () => {
        const response = await server['app'].inject({
            method: 'PUT',
            url: '/api/conductor-workflows/w1',
            payload: {
                name: 'Updated',
                version: 2,
                definition: { name: 'Updated' }
            }
        });
        expect(response.statusCode).toBe(200);
    });

    it('should delete a conductor workflow', async () => {
        const response = await server['app'].inject({
            method: 'DELETE',
            url: '/api/conductor-workflows/w1',
        });
        expect(response.statusCode).toBe(200);
    });
});
