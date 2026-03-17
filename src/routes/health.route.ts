import { Router } from 'express';

/**
 * Contract that any session manager must fulfill to power the /health endpoint.
 * Decoupled from Baileys so the route is testable with a stub.
 */
export interface SessionStatusProvider {
  isConnected(): boolean;
  phoneNumber(): string | undefined;
}

/** GET /health — reports Baileys session status (§8 of spec). */
export function createHealthRouter(session: SessionStatusProvider): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const connected = session.isConnected();
    const phone = session.phoneNumber();

    if (connected) {
      res.json({ status: 'ok', session: 'connected', phone });
    } else {
      res.json({ status: 'error', session: 'disconnected', reason: phone ? 'qr_required' : 'not_started' });
    }
  });

  return router;
}
