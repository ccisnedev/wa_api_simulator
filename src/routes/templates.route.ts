import { Router } from 'express';
import { TEMPLATES } from '../templates/templates.js';
import { createAuthTokenMiddleware } from '../middleware/auth-token.js';

/**
 * GET /{waba-id}/message_templates — Lists available message templates (§4.4 of spec).
 * Mirrors Meta's template listing API with optional filters for name, status, and language.
 */
export function createTemplatesRouter(accessToken: string): Router {
  const router = Router();
  const authMiddleware = createAuthTokenMiddleware(accessToken);

  router.get('/:wabaId/message_templates', authMiddleware, (req, res) => {
    const { name, status, language } = req.query as Record<string, string | undefined>;

    let filtered = [...TEMPLATES];

    if (name) filtered = filtered.filter(t => t.name === name);
    if (status) filtered = filtered.filter(t => t.status === status);
    if (language) filtered = filtered.filter(t => t.language === language);

    // Meta response shape
    res.json({
      data: filtered.map(t => ({
        name: t.name,
        status: t.status,
        category: t.category,
        language: t.language,
        components: t.components.map(c => ({
          type: c.type,
          text: c.text,
          example: { body_text: [Array.from({ length: c.paramCount }, (_, i) => `{{${i + 1}}}`)] },
        })),
        id: t.id,
      })),
      paging: { cursors: { before: '', after: '' } },
    });
  });

  return router;
}
