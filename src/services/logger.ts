// Centralized logger. Routes through console in development and adds
// a breadcrumb for warn/error so the in-app crash report has context.
//
// Use this instead of raw `console.log` / `console.warn` so we have one
// place to swap in Sentry / Crashlytics / a custom transport later.
//
// Pattern:
//   const log = createLogger('voice');
//   log.info('starting', { keyword });
//   log.warn('cap reached', { count });
//   log.error('init failed', err);

import { addBreadcrumb, reportError } from './error-reporting';

type Severity = 'debug' | 'info' | 'warn' | 'error';

type Fields = Record<string, unknown>;

export type Logger = {
  debug: (message: string, data?: Fields) => void;
  info: (message: string, data?: Fields) => void;
  warn: (message: string, data?: Fields) => void;
  error: (message: string, err?: unknown, data?: Fields) => void;
};

function emit(category: string, level: Severity, message: string, data?: Fields) {
  if (__DEV__) {
    const tag = `[${category}:${level}]`;
    if (level === 'error') console.error(tag, message, data ?? '');
    else if (level === 'warn') console.warn(tag, message, data ?? '');
    else console.log(tag, message, data ?? '');
  }
}

export function createLogger(category: string): Logger {
  return {
    debug: (message, data) => {
      emit(category, 'debug', message, data);
    },
    info: (message, data) => {
      emit(category, 'info', message, data);
      addBreadcrumb({
        category,
        severity: 'info',
        message,
        data,
      });
    },
    warn: (message, data) => {
      emit(category, 'warn', message, data);
      addBreadcrumb({
        category,
        severity: 'warn',
        message,
        data,
      });
    },
    error: (message, err, data) => {
      emit(category, 'error', message, data);
      reportError(err ?? new Error(message), {
        category,
        message,
        data,
      });
    },
  };
}
