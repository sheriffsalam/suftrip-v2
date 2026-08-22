export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export type LogContext = Readonly<Record<string, string | number | boolean | null>>;

export interface Logger {
  log(level: LogLevel, message: string, context?: LogContext): void;

  info(message: string, context?: LogContext): void;

  warn(message: string, context?: LogContext): void;

  error(message: string, context?: LogContext): void;
}
