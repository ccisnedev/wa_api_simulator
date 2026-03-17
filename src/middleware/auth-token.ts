import type { Request, Response, NextFunction } from 'express';

/**
 * Creates an Express middleware that validates the Authorization: Bearer token
 * against the configured ACCESS_TOKEN. Endpoints behind this middleware
 * mirror Meta's Cloud API authentication contract.
 */
export function createAuthTokenMiddleware(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: { message: 'Unauthorized', code: 401 } });
      return;
    }

    const token = authHeader.slice('Bearer '.length);

    if (token !== expectedToken) {
      res.status(401).json({ error: { message: 'Invalid access token', code: 401 } });
      return;
    }

    next();
  };
}
