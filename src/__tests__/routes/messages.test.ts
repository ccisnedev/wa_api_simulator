import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createMessagesRouter, type MessageSender } from '../../routes/messages.route.js';
import { SimulatorState } from '../../state/simulator-state.js';

async function injectPost(app: express.Application, path: string, body: any, token: string) {
  const { createServer } = await import('node:http');
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      fetch(`http://127.0.0.1:${addr.port}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          const data = await res.json();
          server.close();
          resolve({ status: res.status, body: data });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

describe('POST /:phoneNumberId/messages', () => {
  const TOKEN = 'sim_access_token';
  let state: SimulatorState;
  let sender: MessageSender;

  beforeEach(() => {
    state = new SimulatorState();
    sender = {
      sendTextMessage: vi.fn(async () => {}),
    };
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/', createMessagesRouter(TOKEN, state, sender));
    return app;
  }

  it('sends text message within 24h window and returns Meta-compatible response', async () => {
    // Mark user as having sent a message recently
    state.recordInbound('51999000001', Date.now());

    const app = buildApp();
    const { status, body } = await injectPost(app, '/sim_pnid_001/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '51999000001',
      type: 'text',
      text: { preview_url: false, body: 'Hola, ¿en qué podemos ayudarte?' },
    }, TOKEN);

    expect(status).toBe(200);
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].wa_id).toBe('51999000001');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].id).toMatch(/^wamid\.sim_/);
    expect(sender.sendTextMessage).toHaveBeenCalledOnce();
  });

  it('rejects text message outside 24h window with Meta error code 131026', async () => {
    // User sent message 25 hours ago — window expired
    state.recordInbound('51999000001', Date.now() - 25 * 60 * 60 * 1000);

    const app = buildApp();
    const { status, body } = await injectPost(app, '/sim_pnid_001/messages', {
      messaging_product: 'whatsapp',
      to: '51999000001',
      type: 'text',
      text: { body: 'This should fail' },
    }, TOKEN);

    expect(status).toBe(400);
    expect(body.error.code).toBe(131026);
    expect(body.error.type).toBe('OAuthException');
    expect(sender.sendTextMessage).not.toHaveBeenCalled();
  });

  it('rejects text message when user has no inbound history', async () => {
    const app = buildApp();
    const { status, body } = await injectPost(app, '/sim_pnid_001/messages', {
      messaging_product: 'whatsapp',
      to: '51999000001',
      type: 'text',
      text: { body: 'No prior conversation' },
    }, TOKEN);

    expect(status).toBe(400);
    expect(body.error.code).toBe(131026);
  });

  it('allows template messages regardless of 24h window', async () => {
    // No inbound history — but templates bypass the window
    const app = buildApp();
    const { status, body } = await injectPost(app, '/sim_pnid_001/messages', {
      messaging_product: 'whatsapp',
      to: '51999000001',
      type: 'template',
      template: {
        name: 'reopen_conversation',
        language: { code: 'es' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Cristian' }] },
        ],
      },
    }, TOKEN);

    expect(status).toBe(200);
    expect(body.messages[0].id).toMatch(/^wamid\.sim_/);
    expect(sender.sendTextMessage).toHaveBeenCalledOnce();
  });

  it('returns 400 for unknown template name', async () => {
    const app = buildApp();
    const { status, body } = await injectPost(app, '/sim_pnid_001/messages', {
      messaging_product: 'whatsapp',
      to: '51999000001',
      type: 'template',
      template: {
        name: 'nonexistent_template',
        language: { code: 'es' },
        components: [],
      },
    }, TOKEN);

    expect(status).toBe(400);
    expect(body.error.code).toBe(132001);
  });

  it('returns 401 without valid auth token', async () => {
    const app = buildApp();
    const { status } = await injectPost(app, '/sim_pnid_001/messages', {
      messaging_product: 'whatsapp',
      to: '51999000001',
      type: 'text',
      text: { body: 'test' },
    }, 'wrong_token');

    expect(status).toBe(401);
  });
});
