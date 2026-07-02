// ============================================================
// PI Web Platform - Logging System (winston-based)
// ============================================================

import winston from "winston";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "..", "data", "logs");

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, context, message, ...rest }) => {
    const ctx = context ? `[${context}]` : "";
    const extra = Object.keys(rest).length
      ? " " + JSON.stringify(rest)
      : "";
    return `${timestamp} ${level} ${ctx} ${message}${extra}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "debug",
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({
      dirname: DATA_DIR,
      filename: "pi-web-platform.log",
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
      format: fileFormat,
    }),
  ],
});

/** Main logger used application-wide */
export default logger;

/** Create a child logger with a fixed context */
export function createLogger(context: string): winston.Logger {
  return logger.child({ context });
}

// Re-export logger type for convenience
export type { Logger } from "winston";
