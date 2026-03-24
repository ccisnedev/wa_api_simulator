import { Router } from 'express';

/**
 * GET /webhook — Meta webhook verification endpoint (§4.1 of spec).
 * Meta calls this to confirm the callback URL before registering it.
 * The simulator replicates this so consumers can validate their webhook setup.
 */
export function createWebhookRouter(verifyToken: string): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'] as string | undefined;
    const token = req.query['hub.verify_token'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;

    if (mode === 'subscribe' && token === verifyToken) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(400);
    }
  });

  return router;
}
