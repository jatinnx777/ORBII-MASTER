// Shared error reporting for edge functions.
//
// The app has had this for a while: error-reporting.ts inserts into
// client_errors and the founder reads it in the admin portal. Edge functions
// had nothing. A drain-push that 500s on every invocation produced no row, no
// alert and no symptom until somebody noticed a push had not arrived.
//
// Two sinks, in this order of importance:
//
//   1. function_errors in Postgres. Always. Zero cost, already has a UI, and it
//      is the one that cannot fail for a reason outside our control.
//   2. Sentry, only if SENTRY_DSN is set in the function environment. The
//      database table records; Sentry notifies. If you want to be woken up,
//      set the DSN. Nothing here depends on it.
//
// Reporting must never throw. A failure to record an error is annoying; a
// failure to record an error that then takes down the emergency path is not.

// deno-lint-ignore no-explicit-any
type Admin = any;

export type Severity = 'warn' | 'error' | 'fatal';

/** Post to Sentry's store endpoint without pulling in the SDK. */
async function toSentry(
  fn: string,
  message: string,
  context: Record<string, unknown> | undefined,
  severity: Severity,
): Promise<void> {
  const dsn = Deno.env.get('SENTRY_DSN');
  if (!dsn) return;

  // DSN form: https://<key>@<host>/<project_id>
  const m = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/);
  if (!m) return;
  const [, key, host, projectId] = m;

  await fetch(`https://${host}/api/${projectId}/store/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': [
        'Sentry sentry_version=7',
        `sentry_key=${key}`,
        'sentry_client=orbii-edge/1.0',
      ].join(', '),
    },
    body: JSON.stringify({
      message,
      level: severity === 'fatal' ? 'fatal' : severity,
      platform: 'javascript',
      server_name: fn,
      timestamp: new Date().toISOString(),
      tags: { fn },
      extra: context ?? {},
    }),
  }).catch(() => undefined);
}

/**
 * Record a failure. Never throws, never rejects.
 *
 * @param fn        the function name, e.g. 'drain-push'
 * @param message   what went wrong, in a sentence
 * @param context   ids and counts. NEVER put a push token, a phone number or a
 *                  location in here: this table is readable by admins and the
 *                  point of the whole product is not holding that data loosely.
 */
export async function report(
  admin: Admin,
  fn: string,
  message: string,
  context?: Record<string, unknown>,
  severity: Severity = 'error',
): Promise<void> {
  try {
    await admin.rpc('log_function_error', {
      p_fn: fn,
      p_message: message,
      p_context: context ?? null,
      p_severity: severity,
    });
  } catch {
    // The database sink is down. Nothing to do but keep going.
  }
  try {
    await toSentry(fn, message, context, severity);
  } catch {
    // ignore
  }
}
