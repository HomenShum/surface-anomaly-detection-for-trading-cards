/**
 * Structured JSON request logger for dealer-OS routes.
 *
 * Emits one line of JSON per route invocation. Render's log explorer
 * (and most providers) parses JSON natively so you can filter by
 * `ownerId`, `route`, `status`, `ms`, etc.
 *
 * Usage in a route handler:
 *
 *   import { withLog } from "@/lib/dealer/log";
 *   export const POST = withLog("cost-basis.write", async (request, ctx) => {
 *     ...
 *   });
 *
 * Or imperatively:
 *   const log = startLog("intake.scan", { ownerId, batchId });
 *   try { ... log.success({ recordIds }); }
 *   catch (e) { log.failure(e); throw e; }
 */

type LogContext = Record<string, unknown>;

type LogStarted = {
  success: (extra?: LogContext) => void;
  failure: (error: unknown, extra?: LogContext) => void;
  emit: (level: "info" | "warn" | "error", message: string, extra?: LogContext) => void;
};

function emitLine(record: Record<string, unknown>) {
  // Single line JSON to stdout — Render / Vercel / most platforms
  // tail this directly. Caller is responsible for not blowing up
  // logs by passing huge payloads.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(record));
}

export function startLog(route: string, context: LogContext = {}): LogStarted {
  const startedAt = Date.now();
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  const base = { ts: new Date().toISOString(), route, requestId, ...context };
  emitLine({ ...base, level: "info", event: "start" });
  return {
    success(extra = {}) {
      emitLine({
        ...base,
        ...extra,
        level: "info",
        event: "success",
        ms: Date.now() - startedAt,
      });
    },
    failure(error, extra = {}) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack?.split("\n").slice(0, 3).join(" ") : undefined;
      emitLine({
        ...base,
        ...extra,
        level: "error",
        event: "failure",
        ms: Date.now() - startedAt,
        error: message,
        stack,
      });
    },
    emit(level, message, extra = {}) {
      emitLine({ ...base, ...extra, level, message });
    },
  };
}
