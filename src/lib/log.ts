/**
 * Structured logging facade for FORGE.
 *
 * Why this exists:
 *
 * Vercel's built-in observability captures stdout/stderr from Node and
 * makes it searchable in the dashboard. To make those logs USEFUL, we
 * want consistent shape — a tag, a message, optional context, and the
 * full error stack when an Error is involved. Without that, errors
 * land as unstructured strings that can't be filtered or grouped.
 *
 * Why a facade rather than direct console.* calls:
 *
 * - One place to add structured metadata (timestamp, severity, tag)
 * - One place to wire up a future SDK (Sentry, Better Stack, etc.) —
 *   if/when we want one, we change one file, not 116 call sites
 * - Easier to silence noisy log lines in tests via a `silenceLog()`
 *   helper later (not today)
 *
 * Conventions:
 *
 *   log.error("[tag]", "what happened", { ctx, error })
 *   log.warn ("[tag]", "soft failure",  { retryAfter: 30 })
 *   log.info ("[tag]", "milestone",     { proposalId })
 *   log.debug("[tag]", "detail",        { rowCount: 7 })
 *
 * The tag is a free-form short string the call site picks
 * (`[runWinnerAnalysis]`, `[email]`, etc.) — same pattern we already
 * use, just consistently as the first argument.
 *
 * Severity mapping:
 *
 * - `error` → console.error  → Vercel ERROR
 * - `warn`  → console.warn   → Vercel WARN
 * - `info`  → console.info   → Vercel INFO
 * - `debug` → console.debug  → Vercel DEBUG (suppressed in production
 *   by Vercel's runtime; appears in dev terminal)
 */

type LogContext = Record<string, unknown>;

type LogPayload = {
  level: "error" | "warn" | "info" | "debug";
  tag: string;
  message: string;
  ctx?: LogContext;
  /** Serialized Error if one was supplied via ctx.error or as the message arg. */
  error?: { name: string; message: string; stack?: string };
};

function serializeError(err: unknown): LogPayload["error"] | undefined {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  if (typeof err === "string") {
    return { name: "Error", message: err };
  }
  return undefined;
}

function emit(
  level: LogPayload["level"],
  tag: string,
  message: string,
  ctx?: LogContext,
): void {
  const payload: LogPayload = {
    level,
    tag,
    message,
  };

  if (ctx) {
    // Pull `error` out of ctx and elevate it to a structured field —
    // Vercel's log viewer + future Sentry both want stack as its own
    // key, not buried inside ctx.
    const { error, ...rest } = ctx as { error?: unknown } & LogContext;
    if (error !== undefined) {
      payload.error = serializeError(error);
    }
    if (Object.keys(rest).length > 0) {
      payload.ctx = rest;
    }
  }

  // In production, emit a single JSON line — Vercel's dashboard parses
  // it and lets you search by any field. In development, emit the
  // human-readable form so terminal output stays readable.
  if (process.env.NODE_ENV === "production") {
    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else if (level === "info") console.info(line);
    else console.debug(line);
    return;
  }

  const args: unknown[] = [tag, message];
  if (payload.ctx) args.push(payload.ctx);
  if (payload.error) args.push(payload.error);
  if (level === "error") console.error(...args);
  else if (level === "warn") console.warn(...args);
  else if (level === "info") console.info(...args);
  else console.debug(...args);
}

export const log = {
  error(tag: string, message: string, ctx?: LogContext): void {
    emit("error", tag, message, ctx);
  },
  warn(tag: string, message: string, ctx?: LogContext): void {
    emit("warn", tag, message, ctx);
  },
  info(tag: string, message: string, ctx?: LogContext): void {
    emit("info", tag, message, ctx);
  },
  debug(tag: string, message: string, ctx?: LogContext): void {
    emit("debug", tag, message, ctx);
  },
};
