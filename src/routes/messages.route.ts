import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { createAuthTokenMiddleware } from '../middleware/auth-token.js';
import { resolveTemplate, findTemplate } from '../templates/templates.js';
import type { SimulatorState } from '../state/simulator-state.js';

/**
 * Abstraction over Baileys' sendMessage — allows testing without a real WhatsApp connection.
 * In production, this calls sock.sendMessage(jid, { text }).
 */
export interface MessageSender {
  sendTextMessage(phoneNumber: string, text: string): Promise<void>;
}

/** Generates a simulator message ID in Meta's wamid format. */
function generateWamid(): string {
  return `wamid.sim_${randomUUID()}`;
}

/**
 * POST /{phone-number-id}/messages — The main outbound endpoint (§4.2 of spec).
 *
 * Handles text and template message types. Validates the 24-hour messaging window
 * for text messages (templates bypass it). Returns Meta-identical responses and error codes.
 */
export function createMessagesRouter(
  accessToken: string,
  state: SimulatorState,
  sender: MessageSender,
): Router {
  const router = Router();
  const authMiddleware = createAuthTokenMiddleware(accessToken);

  router.post('/:phoneNumberId/messages', authMiddleware, async (req, res) => {
    const { to, type, text, template } = req.body;

    // ── Text message ──
    if (type === 'text') {
      if (!state.isWithin24hWindow(to)) {
        res.status(400).json({
          error: {
            message: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
            type: 'OAuthException',
            code: 131026,
            error_data: {
              messaging_product: 'whatsapp',
              details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.',
            },
            fbtrace_id: `sim_${randomUUID()}`,
          },
        });
        return;
      }

      const messageBody = text?.body ?? '';
      await sender.sendTextMessage(to, messageBody);

      const wamid = generateWamid();
      res.json({
        messaging_product: 'whatsapp',
        contacts: [{ input: to, wa_id: to }],
        messages: [{ id: wamid }],
      });
      return;
    }

    // ── Template message ──
    if (type === 'template') {
      const templateName = template?.name;
      const found = findTemplate(templateName);

      if (!found) {
        res.status(400).json({
          error: {
            message: 'Template name does not exist in the translation',
            type: 'OAuthException',
            code: 132001,
            fbtrace_id: `sim_${randomUUID()}`,
          },
        });
        return;
      }

      // Extract parameters from the request body
      const bodyComponent = template?.components?.find((c: any) => c.type === 'body');
      const params = bodyComponent?.parameters?.map((p: any) => p.text) ?? [];

      const resolvedText = resolveTemplate(templateName, params);
      await sender.sendTextMessage(to, resolvedText);

      const wamid = generateWamid();
      res.json({
        messaging_product: 'whatsapp',
        contacts: [{ input: to, wa_id: to }],
        messages: [{ id: wamid }],
      });
      return;
    }

    // ── Unsupported type ──
    res.status(400).json({
      error: {
        message: `Unsupported message type: ${type}`,
        type: 'OAuthException',
        code: 131009,
        fbtrace_id: `sim_${randomUUID()}`,
      },
    });
  });

  return router;
}
