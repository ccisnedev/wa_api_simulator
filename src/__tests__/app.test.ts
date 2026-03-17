import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApp } from '../app.js';
import type { DashboardSession } from '../routes/dashboard.route.js';
import { SimulatorState } from '../state/simulator-state.js';

function createMockSession(): DashboardSession {
  return {
    isConnected: () => true,
    phoneNumber: () => '51999000000',
    currentQR: () => undefined,
    disconnect: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    asStatusProvider: () => ({ isConnected: () => true, phoneNumber: () => '51999000000' }),
    asMessageSender: () => ({ sendTextMessage: vi.fn(async () => {}) }),
  } as any;
}

async function injectGet(app: any, path: string) {
  const { createServer } = await import('node:http');
  return new Promise<{ status: number; body: any; headers: Record<string, string> }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      fetch(`http://127.0.0.1:${addr.port}${path}`)
        .then(async (res) => {
          const ct = res.headers.get('content-type') ?? '';
          const body = ct.includes('json') ? await res.json() : await res.text();
          server.close();
          resolve({ status: res.status, body, headers: Object.fromEntries(res.headers.entries()) });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

describe('createApp', () => {
  const config = {
    port: 3001,
    phoneNumber: '51999000000',
    phoneNumberId: '123456',
    wabaId: '789012',
    accessToken: 'test_token',
    callbackUrl: 'http://localhost:4000/webhook',
    verifyToken: 'test_verify',
    appSecret: 'test_secret',
    mediaDir: './test_media',
    mediaMaxSizeMb: 100,
  };

  it('responds to GET /health', async () => {
    const state = new SimulatorState();
    const session = createMockSession();
    const app = createApp(config, state, session);

    const { status, body } = await injectGet(app, '/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.session).toBe('connected');
  });

  it('responds to GET /dashboard with HTML', async () => {
    const state = new SimulatorState();
    const session = createMockSession();
    const app = createApp(config, state, session);

    const { status, headers } = await injectGet(app, '/dashboard');
    expect(status).toBe(200);
    expect(headers['content-type']).toMatch(/html/);
  });

  it('responds to GET /webhook with hub.challenge verification', async () => {
    const state = new SimulatorState();
    const session = createMockSession();
    const app = createApp(config, state, session);

    const { status, body } = await injectGet(
      app,
      '/webhook?hub.mode=subscribe&hub.verify_token=test_verify&hub.challenge=challenge_ok',
    );
    expect(status).toBe(200);
    expect(body).toBe('challenge_ok');
  });

  it('responds to GET /api/session/status', async () => {
    const state = new SimulatorState();
    const session = createMockSession();
    const app = createApp(config, state, session);

    const { status, body } = await injectGet(app, '/api/session/status');
    expect(status).toBe(200);
    expect(body.status).toBe('connected');
  });
});
