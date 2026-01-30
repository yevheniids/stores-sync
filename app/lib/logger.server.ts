/**
 * Logging Utility
 *
 * Provides structured logging for the application with different log levels
 * and context-aware logging for better debugging and monitoring.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: any;
}

/**
 * Logger configuration
 */
const config = {
  level: (process.env.LOG_LEVEL || "info") as LogLevel,
  enableColors: process.env.NODE_ENV === "development",
};

/**
 * Log level hierarchy
 */
const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * ANSI color codes
 */
const colors = {
  reset: "\x1b[0m",
  debug: "\x1b[36m", // Cyan
  info: "\x1b[32m", // Green
  warn: "\x1b[33m", // Yellow
  error: "\x1b[31m", // Red
};

/**
 * Format log message with color
 */
function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  const levelStr = level.toUpperCase().padEnd(5);

  if (config.enableColors) {
    return `${colors[level]}[${timestamp}] ${levelStr}${colors.reset} ${message}`;
  }

  return `[${timestamp}] ${levelStr} ${message}`;
}

/**
 * Format context object
 */
function formatContext(context?: LogContext): string {
  if (!context || Object.keys(context).length === 0) {
    return "";
  }

  try {
    return `\n${JSON.stringify(context, null, 2)}`;
  } catch (error) {
    return `\n[Unable to stringify context]`;
  }
}

/**
 * Check if log level is enabled
 */
function isLevelEnabled(level: LogLevel): boolean {
  return levels[level] >= levels[config.level];
}

/**
 * Core logging function
 */
function log(level: LogLevel, message: string, context?: LogContext): void {
  if (!isLevelEnabled(level)) {
    return;
  }

  const formattedMessage = formatMessage(level, message);
  const formattedContext = formatContext(context);

  const output = formattedMessage + formattedContext;

  switch (level) {
    case "error":
      console.error(output);
      break;
    case "warn":
      console.warn(output);
      break;
    case "info":
      console.info(output);
      break;
    case "debug":
      console.log(output);
      break;
  }
}

/**
 * Logger instance with convenience methods
 */
export const logger = {
  /**
   * Debug level logging (most verbose)
   */
  debug(message: string, context?: LogContext): void {
    log("debug", message, context);
  },

  /**
   * Info level logging (general information)
   */
  info(message: string, context?: LogContext): void {
    log("info", message, context);
  },

  /**
   * Warning level logging (potential issues)
   */
  warn(message: string, context?: LogContext): void {
    log("warn", message, context);
  },

  /**
   * Error level logging (errors and exceptions)
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext = {
      ...context,
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : error,
    };

    log("error", message, errorContext);
  },

  /**
   * Log webhook received
   */
  webhook(topic: string, shop: string, eventId: string): void {
    log("info", `Webhook received: ${topic}`, {
      topic,
      shop,
      eventId,
      type: "webhook",
    });
  },

  /**
   * Log sync operation
   */
  sync(
    operation: string,
    productId: string,
    storeId: string,
    status: string
  ): void {
    log("info", `Sync operation: ${operation}`, {
      operation,
      productId,
      storeId,
      status,
      type: "sync",
    });
  },

  /**
   * Log queue job
   */
  job(jobName: string, jobId: string, status: string, context?: LogContext): void {
    log("info", `Job ${status}: ${jobName}`, {
      jobName,
      jobId,
      status,
      type: "job",
      ...context,
    });
  },

  /**
   * Log database operation
   */
  database(operation: string, table: string, context?: LogContext): void {
    log("debug", `Database ${operation}: ${table}`, {
      operation,
      table,
      type: "database",
      ...context,
    });
  },

  /**
   * Log API request
   */
  api(
    method: string,
    endpoint: string,
    statusCode: number,
    duration: number
  ): void {
    log("info", `API ${method} ${endpoint} ${statusCode}`, {
      method,
      endpoint,
      statusCode,
      duration,
      type: "api",
    });
  },

  /**
   * Log conflict detection
   */
  conflict(
    conflictType: string,
    productId: string,
    storeId: string,
    context?: LogContext
  ): void {
    log("warn", `Conflict detected: ${conflictType}`, {
      conflictType,
      productId,
      storeId,
      type: "conflict",
      ...context,
    });
  },

  /**
   * Create a child logger with default context
   */
  child(defaultContext: LogContext) {
    return {
      debug(message: string, context?: LogContext): void {
        log("debug", message, { ...defaultContext, ...context });
      },
      info(message: string, context?: LogContext): void {
        log("info", message, { ...defaultContext, ...context });
      },
      warn(message: string, context?: LogContext): void {
        log("warn", message, { ...defaultContext, ...context });
      },
      error(message: string, error?: Error | unknown, context?: LogContext): void {
        logger.error(message, error, { ...defaultContext, ...context });
      },
    };
  },
};

/**
 * Request logger middleware helper
 */
export function createRequestLogger(request: Request) {
  const startTime = Date.now();
  const url = new URL(request.url);

  return {
    log(statusCode: number, context?: LogContext): void {
      const duration = Date.now() - startTime;
      logger.api(request.method, url.pathname, statusCode, duration);
    },
  };
}

export default logger;
