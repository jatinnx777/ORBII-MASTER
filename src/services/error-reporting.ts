// Lightweight error + breadcrumb pipeline. Today it logs to the dev
// console and keeps an in-memory breadcrumb trail for the last 50
// events so a future Sentry / Crashlytics integration can replay them.
//
// To integrate Crashlytics later:
//   1. Install @react-native-firebase/app + @react-native-firebase/crashlytics
//   2. In sendToBackend(), call crashlytics().recordError(e) and
//      breadcrumbs.forEach((b) => crashlytics().log(JSON.stringify(b)))
//
// Until then this gives us:
//   • A single chokepoint for "something went wrong" so we never hide
//     a failure inside a swallowed try/catch.
//   • Breadcrumbs that show what the user did right before a crash.
//   • A simple `wrap` helper for instrumenting service calls.

type Severity = 'info' | 'warn' | 'error';

export type Breadcrumb = {
  at: number;
  category: string;
  message: string;
  severity: Severity;
  data?: Record<string, unknown>;
};

const MAX_BREADCRUMBS = 50;
const breadcrumbs: Breadcrumb[] = [];

export function addBreadcrumb(crumb: Omit<Breadcrumb, 'at'>): void {
  breadcrumbs.push({ ...crumb, at: Date.now() });
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
  if (__DEV__) {
    const prefix = `[crumb:${crumb.severity}]`;
    console.log(prefix, crumb.category, '·', crumb.message, crumb.data ?? '');
  }
}

export function getBreadcrumbs(): readonly Breadcrumb[] {
  return breadcrumbs;
}

export function clearBreadcrumbs(): void {
  breadcrumbs.length = 0;
}

export type ErrorContext = {
  category: string;
  // User-facing summary (safe to display).
  message?: string;
  // Tags for grouping in remote tools.
  tags?: Record<string, string>;
  // Free-form context dump (will not be displayed to user).
  data?: Record<string, unknown>;
};

export function reportError(err: unknown, context: ErrorContext): void {
  const normalised =
    err instanceof Error
      ? err
      : new Error(typeof err === 'string' ? err : JSON.stringify(err));

  addBreadcrumb({
    category: context.category,
    severity: 'error',
    message: context.message ?? normalised.message,
    data: { ...context.tags, ...context.data, name: normalised.name },
  });

  if (__DEV__) {
    console.error(`[error:${context.category}]`, normalised.message, normalised.stack);
  }

  // Forward point, wire to Crashlytics / Sentry here when available.
  void sendToBackend(normalised, context);
}

// Remote sink: best-effort insert into Supabase `client_errors` so the founder
// can see real beta crashes in the dashboard, no Sentry account / native
// module / DSN needed. Never throws (an error in the error pipeline must not
// crash the app), and is silent in dev so we don't spam the table.
async function sendToBackend(err: Error, context: ErrorContext): Promise<void> {
  if (__DEV__) return;
  try {
    // Lazy require so this low-level util never creates a boot-time import
    // cycle with the Supabase client.
    const { supabase } = require('./supabase') as typeof import('./supabase');
    const { Platform } = require('react-native') as typeof import('react-native');
    let userId: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      userId = data.session?.user?.id ?? null;
    } catch {
      // unauthenticated / session unavailable, still log the error
    }
    await supabase.from('client_errors').insert({
      user_id: userId,
      category: context.category,
      message: context.message ?? err.message,
      stack: err.stack ?? null,
      data: { ...context.tags, ...context.data, name: err.name },
      breadcrumbs: breadcrumbs.slice(-20),
      platform: Platform.OS,
    });
  } catch {
    // swallow, the error pipeline must never throw
  }
}

// Capture otherwise-uncaught JS errors so real crashes land in client_errors
// (with the breadcrumb trail) instead of vanishing. Call once at app boot.
export function installGlobalErrorHandler(): void {
  const g = globalThis as unknown as {
    __orbiiErrHandler?: boolean;
    ErrorUtils?: {
      getGlobalHandler?: () => ((e: unknown, fatal?: boolean) => void) | undefined;
      setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void;
    };
  };
  if (g.__orbiiErrHandler || !g.ErrorUtils?.setGlobalHandler) return;
  g.__orbiiErrHandler = true;
  const prev = g.ErrorUtils.getGlobalHandler?.();
  g.ErrorUtils.setGlobalHandler((e: unknown, fatal?: boolean) => {
    reportError(e, { category: 'uncaught', tags: { fatal: String(!!fatal) } });
    prev?.(e, fatal);
  });
}

// Wraps an async fn so any throw is captured + re-thrown. Use this on
// service entry points where the failure mode matters but the calling
// UI also needs to know (so we can't just swallow).
export function wrap<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  context: ErrorContext,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    try {
      return await fn(...args);
    } catch (err) {
      reportError(err, context);
      throw err;
    }
  };
}

// Drop-in for fire-and-forget calls where we want to log but never
// re-throw. Returns a fallback value instead of letting the error bubble.
export async function safeAsync<T>(
  fn: () => Promise<T>,
  fallback: T,
  context: ErrorContext,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    reportError(err, context);
    return fallback;
  }
}
