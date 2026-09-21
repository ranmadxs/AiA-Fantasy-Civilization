import {
  clearBuffer,
  debug,
  flushLogs,
  formatLogLine,
  getBuffer,
  registerAppender,
} from "../src/world/debugLog";

describe("logger único con appenders", () => {
  beforeEach(() => {
    clearBuffer();
  });

  test("formatLogLine estilo Java: fecha ms NIVEL [tag] mensaje", () => {
    const line = formatLogLine({
      time: "2026-09-17 01:55:41.123",
      level: "error",
      tag: "llmExecutor",
      message: "falló",
    });
    expect(line).toBe("2026-09-17 01:55:41.123 ERROR [llmExecutor] falló");
    expect(formatLogLine({ time: "t", level: "info", tag: "x", message: "m" })).toContain("INFO ");
  });

  test("fan-out: un evento llega a todos los appenders; uno roto no tumba", () => {
    const seenA: string[] = [];
    const seenB: string[] = [];
    registerAppender((e) => { seenA.push(e.message); });
    registerAppender(() => { throw new Error("appender roto"); });
    registerAppender((e) => { seenB.push(e.message); });
    debug.tag("test").warn("hola");
    expect(seenA).toContain("hola");
    expect(seenB).toContain("hola");
    expect(getBuffer().some((e) => e.tag === "test" && e.message === "hola")).toBe(true);
  });

  test("buffer acotado y limpiable", () => {
    for (let i = 0; i < 1200; i += 1) {
      debug.info(`msg-${i}`);
    }
    const buf = getBuffer();
    expect(buf.length).toBeLessThanOrEqual(1000);
    expect(buf[buf.length - 1].message).toBe("msg-1199");
    clearBuffer();
    expect(getBuffer()).toHaveLength(0);
  });

  test("flushLogs en node (sin window) es no-op seguro", async () => {
    await expect(flushLogs()).resolves.toBeUndefined();
  });

  test("flush caído reintenta solo (no muere para siempre)", async () => {
    jest.useFakeTimers();
    try {
      const g = globalThis as any;
      const realWindow = g.window;
      const realFetch = g.fetch;
      const realDocument = g.document;
      g.window = { addEventListener: () => undefined };
      g.document = { visibilityState: "visible", addEventListener: () => undefined };
      let fail = true;
      const posted: string[][] = [];
      g.fetch = async (_url: string, init: any) => {
        if (fail) throw new Error("servidor caído");
        posted.push(JSON.parse(init.body).lines);
        return { ok: true };
      };
      try {
        debug.tag("disktest").warn("linea-1");
        await flushLogs();
        // Cayó: la línea se conserva en cola.
        await flushLogs();
        // Servidor de vuelta: reintenta y drena sin recargar nada.
        fail = false;
        jest.advanceTimersByTime(31000);
        await flushLogs();
        await flushLogs();
        expect(posted.flat()).toContainEqual(expect.stringContaining("linea-1"));
      } finally {
        g.window = realWindow;
        g.fetch = realFetch;
        g.document = realDocument;
      }
    } finally {
      jest.useRealTimers();
    }
  });
});
