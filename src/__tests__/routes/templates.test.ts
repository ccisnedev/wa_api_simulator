import { describe, it, expect } from 'vitest';
import express from 'express';
import { createTemplatesRouter } from '../../routes/templates.route.js';

async function injectGet(app: express.Application, path: string, token: string) {
  const { createServer } = await import('node:http');
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      fetch(`http://127.0.0.1:${addr.port}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

describe('GET /:wabaId/message_templates', () => {
  const TOKEN = 'sim_access_token';

  function buildApp() {
    const app = express();
    app.use('/', createTemplatesRouter(TOKEN));
    return app;
  }

  it('returns all templates with Meta-compatible structure', async () => {
    const app = buildApp();
    const { status, body } = await injectGet(app, '/sim_waba_001/message_templates', TOKEN);

    expect(status).toBe(200);
    expect(body.data).toBeDefined();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.paging).toBeDefined();

    const template = body.data[0];
    expect(template.name).toBe('reopen_conversation');
    expect(template.status).toBe('APPROVED');
    expect(template.components).toBeDefined();
  });

  it('filters templates by name query parameter', async () => {
    const app = buildApp();

    const { body: found } = await injectGet(
      app,
      '/sim_waba_001/message_templates?name=reopen_conversation',
      TOKEN,
    );
    expect(found.data).toHaveLength(1);

    const { body: notFound } = await injectGet(
      app,
      '/sim_waba_001/message_templates?name=nonexistent',
      TOKEN,
    );
    expect(notFound.data).toHaveLength(0);
  });

  it('returns 401 without valid auth token', async () => {
    const app = buildApp();
    const { status } = await injectGet(app, '/sim_waba_001/message_templates', 'wrong');

    expect(status).toBe(401);
  });
});
