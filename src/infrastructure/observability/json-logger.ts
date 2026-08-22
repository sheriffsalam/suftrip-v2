import type { LogContext, Logger, LogLevel } from '../../application/observability/logger.js';

type LogRecord = Readonly<{
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
}>;

export class JsonLogger implements Logger {
  constructor(private readonly output: (line: string) => void = console.log) {}

  log(level: LogLevel, message: string, context?: LogContext): void {
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context ? { context } : {}),
    };
    this.output(JSON.stringify(record));
  }

  info(message: string, context?: LogContext): void {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('WARN', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('ERROR', message, context);
  }
}
