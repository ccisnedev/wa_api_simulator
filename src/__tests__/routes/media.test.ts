import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { SimulatorState } from '../../state/simulator-state.js';
import { createMediaRouter } from '../../routes/media.route.js';

async function inject(app: express.Application, path: string, token: string) {
  const { createServer } = await import('node:http');
  return new Promise<{ status: number; headers: Headers; body: any; rawBody: Buffer }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      fetch(`http://127.0.0.1:${addr.port}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (res) => {
          const rawBody = Buffer.from(await res.arrayBuffer());
          let body: any;
          try { body = JSON.parse(rawBody.toString()); } catch { body = rawBody; }
          server.close();
          resolve({ status: res.status, headers: res.headers, body, rawBody });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

describe('media routes', () => {
  const TOKEN = 'sim_access_token';
  let tempDir: string;
  let state: SimulatorState;

  beforeEach(() => {
    tempDir = join(tmpdir(), `wa_api_media_route_${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    state = new SimulatorState();

    // Register a test media entry
    const filePath = join(tempDir, 'sim_media_001.jpg');
    writeFileSync(filePath, Buffer.from('fake jpg binary'));
    state.registerMedia({
      mediaId: 'sim_media_001',
      localPath: filePath,
      mimeType: 'image/jpeg',
      fileSize: 15,
      sha256: 'abc123def456',
      downloadedAt: Date.now(),
    });
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  function buildApp() {
    const app = express();
    app.use('/', createMediaRouter(TOKEN, state));
    return app;
  }

  describe('GET /:mediaId (metadata)', () => {
    it('returns media metadata with download URL', async () => {
      const app = buildApp();
      const { status, body } = await inject(app, '/sim_media_001', TOKEN);

      expect(status).toBe(200);
      expect(body.id).toBe('sim_media_001');
      expect(body.mime_type).toBe('image/jpeg');
      expect(body.sha256).toBe('abc123def456');
      expect(body.file_size).toBe(15);
      expect(body.url).toContain('/media/download/sim_media_001');
      expect(body.messaging_product).toBe('whatsapp');
    });

    it('returns 404 for unknown media id', async () => {
      const app = buildApp();
      const { status } = await inject(app, '/nonexistent_media', TOKEN);

      expect(status).toBe(404);
    });

    it('returns 401 without valid auth', async () => {
      const app = buildApp();
      const { status } = await inject(app, '/sim_media_001', 'wrong');

      expect(status).toBe(401);
    });
  });

  describe('GET /media/download/:mediaId (binary)', () => {
    it('returns the binary file with correct Content-Type', async () => {
      const app = buildApp();
      const { status, headers, rawBody } = await inject(app, '/media/download/sim_media_001', TOKEN);

      expect(status).toBe(200);
      expect(headers.get('content-type')).toContain('image/jpeg');
      expect(rawBody.toString()).toBe('fake jpg binary');
    });

    it('returns 404 for unknown media id', async () => {
      const app = buildApp();
      const { status } = await inject(app, '/media/download/nonexistent', TOKEN);

      expect(status).toBe(404);
    });
  });
});
