import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import { createDashboardRouter, type DashboardSession } from '../../routes/dashboard.route.js';

/** Minimal helper — ephemeral HTTP server for GET requests. */
async function injectGet(app: express.Application, path: string) {
  const { createServer } = await import('node:http');
  return new Promise<{ status: number; headers: Record<string, string>; body: any }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      fetch(`http://127.0.0.1:${addr.port}${path}`)
        .then(async (res) => {
          const ct = res.headers.get('content-type') ?? '';
          const body = ct.includes('json') ? await res.json() : await res.text();
          server.close();
          resolve({ status: res.status, headers: Object.fromEntries(res.headers.entries()), body });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

/** Minimal helper — ephemeral HTTP server for POST requests. */
async function injectPost(app: express.Application, path: string) {
  const { createServer } = await import('node:http');
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      fetch(`http://127.0.0.1:${addr.port}${path}`, { method: 'POST' })
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

function createMockSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    isConnected: () => false,
    phoneNumber: () => undefined,
    currentQR: () => undefined,
    disconnect: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    getDashboardStatus: () => 'idle',
    getStatusMessage: () => '',
    ...overrides,
  };
}

describe('dashboard routes', () => {
  describe('GET /dashboard', () => {
    it('returns HTML with status 200', async () => {
      const session = createMockSession();
      const app = express();
      app.use('/', createDashboardRouter(session));

      const { status, headers } = await injectGet(app, '/dashboard');
      expect(status).toBe(200);
      expect(headers['content-type']).toMatch(/html/);
    });
  });

  describe('GET /api/session/status', () => {
    it('returns idle status when no session is linked', async () => {
      const session = createMockSession({
        getDashboardStatus: () => 'idle',
        getStatusMessage: () => 'No hay sesión vinculada',
      });
      const app = express();
      app.use('/', createDashboardRouter(session));

      const { status, body } = await injectGet(app, '/api/session/status');
      expect(status).toBe(200);
      expect(body).toEqual({ status: 'idle', statusMessage: 'No hay sesión vinculada' });
    });

    it('returns connected status with phone when session is connected', async () => {
      const session = createMockSession({
        isConnected: () => true,
        phoneNumber: () => '51999000000',
        getDashboardStatus: () => 'connected',
        getStatusMessage: () => '',
      });
      const app = express();
      app.use('/', createDashboardRouter(session));

      const { status, body } = await injectGet(app, '/api/session/status');
      expect(status).toBe(200);
      expect(body).toEqual({ status: 'connected', phone: '51999000000', statusMessage: '' });
    });

    it('returns pairing_qr status with QR when QR is available', async () => {
      const session = createMockSession({
        currentQR: () => 'mock_qr_data_string',
        getDashboardStatus: () => 'pairing_qr',
        getStatusMessage: () => '',
      });
      const app = express();
      app.use('/', createDashboardRouter(session));

      const { status, body } = await injectGet(app, '/api/session/status');
      expect(status).toBe(200);
      expect(body.status).toBe('pairing_qr');
      expect(body.qr).toBe('mock_qr_data_string');
      expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it('returns qr_expired status after QR timeout', async () => {
      const session = createMockSession({
        getDashboardStatus: () => 'qr_expired',
        getStatusMessage: () => 'El código QR expiró',
      });
      const app = express();
      app.use('/', createDashboardRouter(session));

      const { status, body } = await injectGet(app, '/api/session/status');
      expect(status).toBe(200);
      expect(body).toEqual({ status: 'qr_expired', statusMessage: 'El código QR expiró' });
    });

    it('returns replaced status when connection is taken by another device', async () => {
      const session = createMockSession({
        getDashboardStatus: () => 'replaced',
        getStatusMessage: () => 'WhatsApp está abierto en otro dispositivo',
      });
      const app = express();
      app.use('/', createDashboardRouter(session));

      const { status, body } = await injectGet(app, '/api/session/status');
      expect(status).toBe(200);
      expect(body).toEqual({ status: 'replaced', statusMessage: 'WhatsApp está abierto en otro dispositivo' });
    });
  });

  describe('POST /api/session/logout', () => {
    it('returns 200 and calls disconnect with clearAuth', async () => {
      const disconnectFn = vi.fn(async () => {});
      const session = createMockSession({ disconnect: disconnectFn });
      const app = express();
      app.use('/', createDashboardRouter(session));

      const { status, body } = await injectPost(app, '/api/session/logout');
      expect(status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(disconnectFn).toHaveBeenCalledWith(true);
    });
  });

  describe('POST /api/session/reconnect', () => {
    it('returns 200 and calls disconnect(false) then connect', async () => {
      const disconnectFn = vi.fn(async () => {});
      const connectFn = vi.fn(async () => {});
      const session = createMockSession({ disconnect: disconnectFn, connect: connectFn });
      const app = express();
      app.use('/', createDashboardRouter(session));

      const { status, body } = await injectPost(app, '/api/session/reconnect');
      expect(status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(disconnectFn).toHaveBeenCalledWith(false);
      expect(connectFn).toHaveBeenCalled();
    });
  });
});
