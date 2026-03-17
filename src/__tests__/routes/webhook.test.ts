import { describe, it, expect } from 'vitest';
import express from 'express';
import { createWebhookRouter } from '../../routes/webhook.route.js';

async function injectGet(app: express.Application, path: string) {
  const { createServer } = await import('node:http');
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      fetch(`http://127.0.0.1:${addr.port}${path}`)
        .then(async (res) => {
          const body = await res.text();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

describe('GET /webhook (hub.challenge verification)', () => {
  const verifyToken = 'help_verify_secret_2024';

  it('returns 200 with challenge when token matches', async () => {
    const app = express();
    app.use('/webhook', createWebhookRouter(verifyToken));

    const { status, body } = await injectGet(
      app,
      '/webhook?hub.mode=subscribe&hub.verify_token=help_verify_secret_2024&hub.challenge=test_challenge_123',
    );

    expect(status).toBe(200);
    expect(body).toBe('test_challenge_123');
  });

  it('returns 400 when verify_token does not match', async () => {
    const app = express();
    app.use('/webhook', createWebhookRouter(verifyToken));

    const { status } = await injectGet(
      app,
      '/webhook?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=abc',
    );

    expect(status).toBe(400);
  });

  it('returns 400 when hub.mode is not subscribe', async () => {
    const app = express();
    app.use('/webhook', createWebhookRouter(verifyToken));

    const { status } = await injectGet(
      app,
      '/webhook?hub.mode=unsubscribe&hub.verify_token=help_verify_secret_2024&hub.challenge=abc',
    );

    expect(status).toBe(400);
  });

  it('returns 400 when query params are missing', async () => {
    const app = express();
    app.use('/webhook', createWebhookRouter(verifyToken));

    const { status } = await injectGet(app, '/webhook');

    expect(status).toBe(400);
  });
});
