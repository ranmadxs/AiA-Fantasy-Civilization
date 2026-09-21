type ConnectionState = "connected" | "disconnected";

type ConnectionChangeCallback = (state: ConnectionState) => void;

export class ConnectionMonitor {
  private static instance: ConnectionMonitor;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private consecutiveFails = 0;
  private readonly maxFails = 3;
  private readonly intervalMs = 5000;
  private state: ConnectionState = "connected";
  private callbacks: ConnectionChangeCallback[] = [];
  private readonly endpoint: string;

  private constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  static getInstance(endpoint?: string): ConnectionMonitor {
    if (!ConnectionMonitor.instance) {
      ConnectionMonitor.instance = new ConnectionMonitor(endpoint ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"));
    }
    return ConnectionMonitor.instance;
  }

  getState(): ConnectionState {
    return this.state;
  }

  onChange(callback: ConnectionChangeCallback): void {
    this.callbacks.push(callback);
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => {
      void this.check();
    }, this.intervalMs);
    void this.check();
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.consecutiveFails = 0;
  }

  private async check(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(this.endpoint, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.onSuccess();
    } catch {
      this.onFail();
    }
  }

  private onSuccess(): void {
    this.consecutiveFails = 0;
    if (this.state !== "connected") {
      this.state = "connected";
      this.notify("connected");
    }
  }

  private onFail(): void {
    this.consecutiveFails++;
    if (this.consecutiveFails >= this.maxFails && this.state !== "disconnected") {
      this.state = "disconnected";
      this.notify("disconnected");
    }
  }

  private notify(state: ConnectionState): void {
    for (const cb of this.callbacks) {
      try { cb(state); } catch { /* ignore callback errors */ }
    }
  }
}
