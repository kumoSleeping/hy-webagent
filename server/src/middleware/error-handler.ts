import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";

const log = createLogger("http");

export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly options?: { expose?: boolean; code?: string }
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function attachRequestId(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as Request & { requestId?: string }).requestId ?? "unknown";

  if (err instanceof AppError) {
    if (err.status >= 500) {
      log.error(`${err.message}`, { requestId, stack: err.stack });
      res.status(err.status).json({ error: "Internal server error", requestId });
      return;
    }
    res.status(err.status).json({
      error: err.options?.expose === false ? "Request failed" : err.message,
      ...(err.options?.code ? { code: err.options.code } : {}),
      requestId,
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  log.error(`Unhandled error: ${message}`, {
    requestId,
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({ error: "Internal server error", requestId });
}
