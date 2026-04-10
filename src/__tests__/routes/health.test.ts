import { describe, it, expect } from 'vitest';
import express from 'express';
import { createHealthRouter, type SessionStatusProvider } from '../../routes/health.route.js';

/** Minimal helper to test Express routes without starting a real HTTP server. */
async function injectGet(app: express.Application, path: string) {
  // Use node's built-in test client approach — spin up ephemeral server
  const { createServer } = await import('node:http');
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      fetch(`http://127.0.0.1:${addr.port}${path}`)
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

describe('GET /health', () => {
  it('returns disconnected status when session is not connected', async () => {
    const provider: SessionStatusProvider = {
      isConnected: () => false,
      phoneNumber: () => undefined,
    };

    const app = express();
    app.use('/health', createHealthRouter(provider));

    const { status, body } = await injectGet(app, '/health');

    expect(status).toBe(200);
    expect(body.status).toBe('error');
    expect(body.session).toBe('disconnected');
  });

  it('returns connected status with phone number when session is active', async () => {
    const provider: SessionStatusProvider = {
      isConnected: () => true,
      phoneNumber: () => '51999000000',
    };

    const app = express();
    app.use('/health', createHealthRouter(provider));

    const { status, body } = await injectGet(app, '/health');

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.session).toBe('connected');
    expect(body.phone).toBe('51999000000');
  });
});
