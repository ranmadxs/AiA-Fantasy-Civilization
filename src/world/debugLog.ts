/**
 * debugLog — logger único con appenders (estilo Java: una llamada, N destinos).
 *
 * Se activa la consola con `?debug=1` en la URL o `localStorage.aia_debug = "1"`.
 * Apagado por defecto: cero ruido en la consola del jugador.
 *
 * Appenders registrados por defecto:
 * - consola web (respeta el flag debug),
 * - memoria (buffer para UI/diagnóstico),
 * - disco (POST por lotes a /__aia-log del dev server → target/app.log y
 *   target/error.log; servicio automático, sin botones).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  time: string;
  level: LogLevel;
  tag: string;
  message: string;
};

export type LogAppender = (entry: LogEntry) => void;

const MAX_BUFFER = 1000;
const DISK_FLUSH_INTERVAL_MS = 10_000;
/** Tras una caída se reintenta solo pasado este backoff (cura reinicios del dev). */
const DISK_RETRY_BACKOFF_MS = 30_000;
const LOG_ENDPOINT = "/__aia-log";

const buffer: LogEntry[] = [];
const appenders: LogAppender[] = [];
let enabledCache: boolean | null = null;
let handlersInstalled = false;
let diskQueue: string[] = [];
let diskTimer: ReturnType<typeof setInterval> | undefined;
let lastDiskFailAt = 0;
let pageHideHookInstalled = false;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** Línea estilo Java: `2026-09-17 01:55:41.123 INFO  [tag] mensaje`. Pura y testeable. */
export function formatLogLine(entry: LogEntry): string {
  return `${entry.time} ${entry.level.toUpperCase().padEnd(5, " ")} [${entry.tag}] ${entry.message}`;
}

export function logTimestamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** Registra un appender adicional (fan-out). */
export function registerAppender(appender: LogAppender): void {
  appenders.push(appender);
}

function stringifyArg(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function emit(level: LogLevel, tag: string, args: unknown[]): void {
  const entry: LogEntry = {
    time: logTimestamp(),
    level,
    tag,
    message: args.map(stringifyArg).join(" "),
  };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  for (const appender of appenders) {
    try {
      appender(entry);
    } catch {
      // Un appender roto no tumba el log ni el juego.
    }
  }
}

/** Copia del buffer en memoria (para UI/diagnóstico). */
export function getBuffer(): LogEntry[] {
  return [...buffer];
}

/** Limpia el buffer en memoria. */
export function clearBuffer(): void {
  buffer.length = 0;
}

function consoleAppender(entry: LogEntry): void {
  if (!debugEnabled()) return;
  const fn = entry.level === "debug" ? console.debug : console[entry.level] ?? console.log;
  fn(`[aia:${entry.level}] ${entry.time} [${entry.tag}]`, entry.message);
}

function diskAppender(entry: LogEntry): void {
  if (typeof window === "undefined" || typeof fetch === "undefined") return;
  diskQueue.push(formatLogLine(entry));
  scheduleDiskFlush();
}

function scheduleDiskFlush(): void {
  if (typeof window === "undefined") return;
  installPageHideHook();
  if (diskTimer !== undefined) return;
  diskTimer = globalThis.setInterval(() => {
    void flushLogs();
  }, DISK_FLUSH_INTERVAL_MS);
}

function installPageHideHook(): void {
  if (pageHideHookInstalled || typeof window === "undefined") return;
  pageHideHookInstalled = true;
  const flush = () => {
    void flushLogs();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/** Envía la cola al servicio de logs. Sin botones: lo llaman el turno y el timer. */
export async function flushLogs(): Promise<void> {
  if (typeof window === "undefined" || typeof fetch === "undefined") return;
  if (diskQueue.length === 0) return;
  // Backoff tras caídas: se reintenta solo (cura reinicios del dev server).
  if (Date.now() - lastDiskFailAt < DISK_RETRY_BACKOFF_MS) return;
  const lines = diskQueue;
  diskQueue = [];
  try {
    const response = await fetch(LOG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
      keepalive: true,
    });
    if (!response.ok) {
      diskQueue = [...lines, ...diskQueue];
      lastDiskFailAt = Date.now();
    }
  } catch {
    // Sin middleware (build estático) o servidor caído: se conserva la cola
    // (acotada) y se reintenta con backoff. Sin botones, sin interrumpir.
    lastDiskFailAt = Date.now();
    diskQueue = [...lines, ...diskQueue].slice(-MAX_BUFFER);
  }
}

registerAppender(consoleAppender);
registerAppender(diskAppender);

function readFlag(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).has("debug")) return true;
    return window.localStorage?.getItem("aia_debug") === "1";
  } catch {
    return false;
  }
}

/** ¿Está activo el debug? (?debug=1 o localStorage.aia_debug=1) */
export function debugEnabled(): boolean {
  if (enabledCache === null) enabledCache = readFlag();
  return enabledCache;
}

/** Relee el flag (por si cambió localStorage en caliente). */
export function refreshDebugFlag(): boolean {
  enabledCache = readFlag();
  return enabledCache;
}

function push(level: LogLevel, args: unknown[]): void {
  emit(level, "app", args);
}

function pushTagged(level: LogLevel, tag: string, args: unknown[]): void {
  emit(level, tag, args);
}

const starts = new Map<string, number>();

export type TaggedLogger = {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

export const debug = {
  enabled: debugEnabled,
  log(...args: unknown[]): void { push("debug", args); },
  info(...args: unknown[]): void { push("info", args); },
  warn(...args: unknown[]): void { push("warn", args); },
  error(...args: unknown[]): void { push("error", args); },

  /** Logger con tag fijo (clase/módulo) para líneas `[...]` con origen. */
  tag(tag: string): TaggedLogger {
    return {
      log(...args: unknown[]): void { pushTagged("debug", tag, args); },
      info(...args: unknown[]): void { pushTagged("info", tag, args); },
      warn(...args: unknown[]): void { pushTagged("warn", tag, args); },
      error(...args: unknown[]): void { pushTagged("error", tag, args); },
    };
  },

  /** Inicia un cronómetro. Usa timeEnd con el mismo label. */
  time(label: string): void {
    starts.set(label, performance.now());
    if (debugEnabled()) console.time(`[aia] ${label}`);
  },

  /** Cierra el cronómetro y loguea los ms (siempre al log, a consola solo en debug). */
  timeEnd(label: string): number {
    const start = starts.get(label) ?? performance.now();
    starts.delete(label);
    const ms = performance.now() - start;
    emit("info", "perf", [`${label}: ${ms.toFixed(0)}ms`]);
    if (debugEnabled()) console.timeEnd(`[aia] ${label}`);
    return ms;
  },

  /** Descarga el buffer como texto (botón de la pantalla de error). */
  download(filename = "aia-debug.log"): void {
    try {
      const text = buffer.map(formatLogLine).join("\n");
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // sin DOM (tests/node): no-op
    }
  },

  /** Captura errores/rechazos globales hacia el log (una sola vez). */
  installGlobalHandlers(): void {
    if (handlersInstalled || typeof window === "undefined") return;
    handlersInstalled = true;
    window.addEventListener("error", (e) => {
      emit("error", "window", ["window.onerror:", e.message, e.filename, e.lineno]);
    });
    window.addEventListener("unhandledrejection", (e) => {
      emit("error", "window", ["unhandledrejection:", String((e as PromiseRejectionEvent).reason)]);
    });
  },
};
