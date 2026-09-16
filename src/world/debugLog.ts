/**
 * debugLog — logger mínimo con niveles para la web.
 *
 * Se activa con `?debug=1` en la URL o `localStorage.aia_debug = "1"`.
 * Apagado por defecto: cero ruido en la consola del jugador.
 *
 * Sirve para: tiempos en puntos calientes (buildDemoWorld, mapSkin),
 * warnings de assets y captura global de errores no manejados.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const MAX_BUFFER = 300;
const buffer: { t: string; level: LogLevel; args: unknown[] }[] = [];
let enabledCache: boolean | null = null;
let handlersInstalled = false;

function readFlag(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).has("debug")) return true;
    return window.localStorage?.getItem("aia_debug") === "1";
  } catch {
    return false;
  }
}

/** ¿Está activo el debug? ( Hernandez: ?debug=1 o localStorage.aia_debug=1 ) */
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
  const t = new Date().toISOString().slice(11, 23);
  buffer.push({ t, level, args });
  if (buffer.length > MAX_BUFFER) buffer.shift();
  if (!debugEnabled()) return;
  const fn = level === "debug" ? console.debug : console[level] ?? console.log;
  fn(`[aia:${level}] ${t}`, ...args);
}

const starts = new Map<string, number>();

export const debug = {
  enabled: debugEnabled,
  log(...args: unknown[]): void { push("debug", args); },
  info(...args: unknown[]): void { push("info", args); },
  warn(...args: unknown[]): void { push("warn", args); },
  error(...args: unknown[]): void { push("error", args); },

  /** Inicia un cronómetro. Usa timeEnd con el mismo label. */
  time(label: string): void {
    starts.set(label, performance.now());
    if (debugEnabled()) console.time(`[aia] ${label}`);
  },

  /** Cierra el cronómetro y loguea los ms (siempre al buffer, a consola solo en debug). */
  timeEnd(label: string): number {
    const start = starts.get(label) ?? performance.now();
    starts.delete(label);
    const ms = performance.now() - start;
    const t = new Date().toISOString().slice(11, 23);
    buffer.push({ t, level: "info", args: [`${label}: ${ms.toFixed(0)}ms`] });
    if (buffer.length > MAX_BUFFER) buffer.shift();
    if (debugEnabled()) console.timeEnd(`[aia] ${label}`);
    return ms;
  },

  /** Descarga el buffer como texto (para pegar en un reporte de bug). */
  download(filename = "aia-debug.log"): void {
    try {
      const text = buffer
        .map((e) => `${e.t} [${e.level}] ${e.args.map((a) => String(a)).join(" ")}`)
        .join("\n");
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

  /** Captura errores/rechazos globales hacia el buffer (una sola vez). */
  installGlobalHandlers(): void {
    if (handlersInstalled || typeof window === "undefined") return;
    handlersInstalled = true;
    window.addEventListener("error", (e) => {
      push("error", ["window.onerror:", e.message, e.filename, e.lineno]);
    });
    window.addEventListener("unhandledrejection", (e) => {
      push("error", ["unhandledrejection:", String((e as PromiseRejectionEvent).reason)]);
    });
  },
};
