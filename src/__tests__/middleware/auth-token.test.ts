import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createAuthTokenMiddleware } from '../../middleware/auth-token.js';

function mockReq(authHeader?: string): Partial<Request> {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

function mockRes(): Partial<Response> & { statusCode: number; body: any } {
  const res: any = { statusCode: 200, body: null };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (data: any) => { res.body = data; return res; };
  return res;
}

describe('auth-token middleware', () => {
  const middleware = createAuthTokenMiddleware('sim_access_token');

  it('calls next() when Bearer token matches ACCESS_TOKEN', () => {
    const req = mockReq('Bearer sim_access_token');
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 when Authorization header is missing', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when token does not match', () => {
    const req = mockReq('Bearer wrong_token');
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when Authorization scheme is not Bearer', () => {
    const req = mockReq('Basic sim_access_token');
    const res = mockRes();
    const next = vi.fn();

    middleware(req as Request, res as Response, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
