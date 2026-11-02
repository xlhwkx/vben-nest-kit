import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
  requestContextAls,
  type RequestContextStore,
} from "../request-context";

export type RequestWithId = Request & { requestId?: string };

/**
 * Ensure every request/response has `x-request-id`, and stash
 * request metadata in AsyncLocalStorage for AuditService.
 */
export function requestIdMiddleware(
  req: RequestWithId,
  res: Response,
  next: NextFunction,
): void {
  const raw = req.headers["x-request-id"];
  const incoming = Array.isArray(raw) ? raw[0] : raw;
  const requestId =
    typeof incoming === "string" && incoming.trim()
      ? incoming.trim().slice(0, 128)
      : randomUUID();

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  const store: RequestContextStore = {
    requestId,
    ip: req.ip,
    userAgent:
      typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"].slice(0, 512)
        : undefined,
    method: req.method,
    path: (req.originalUrl || req.url || "").split("?")[0],
  };

  requestContextAls.run(store, () => next());
}
