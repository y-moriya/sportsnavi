export type LogLevel = "info" | "warn" | "error";

export interface LogPayload {
  _time?: string;
  app: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
  };
}

export interface LoggerOptions {
  appName?: string;
  dataset?: string;
  token?: string;
}

export class Logger {
  private appName: string;
  private dataset: string;
  private token: string | undefined;
  private queue: LogPayload[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: LoggerOptions = {}) {
    this.appName = options.appName ?? "sportsnavi";
    const isTest =
      typeof process !== "undefined" &&
      (process.env?.NODE_ENV === "test" || Boolean(process.env?.VITEST));
    this.dataset =
      options.dataset ??
      (!isTest && typeof process !== "undefined" ? process.env?.AXIOM_DATASET : undefined) ??
      "personal-apps";
    const token =
      options.token ??
      (!isTest && typeof process !== "undefined" ? process.env?.AXIOM_TOKEN : undefined);
    this.token = token ? token.trim() : undefined;
  }

  /**
   * Log an informational message.
   */
  info(message: string, data?: Record<string, unknown>): void {
    console.info(`[${this.appName}] [INFO] ${message}`, data ? JSON.stringify(data) : "");
    this.enqueue("info", message, data);
  }

  /**
   * Log a warning message.
   */
  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(`[${this.appName}] [WARN] ${message}`, data ? JSON.stringify(data) : "");
    this.enqueue("warn", message, data);
  }

  /**
   * Log an error message.
   */
  error(message: string, err?: unknown, data?: Record<string, unknown>): void {
    const errorDetails = err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : err ? { message: String(err) } : undefined;

    console.error(
      `[${this.appName}] [ERROR] ${message}`,
      errorDetails || "",
      data ? JSON.stringify(data) : "",
    );
    this.enqueue("error", message, data, errorDetails);
  }

  private enqueue(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: LogPayload["error"],
  ): void {
    if (!this.token) {
      return;
    }

    const payload: LogPayload = {
      _time: new Date().toISOString(),
      app: this.appName,
      level,
      message,
      ...(data ? { data } : {}),
      ...(error ? { error } : {}),
    };

    this.queue.push(payload);

    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush().catch((err) => {
          console.error(`[${this.appName}] Failed to flush logs to Axiom:`, err);
        });
      }, 1000);
    }
  }

  /**
   * Immediately send all queued logs to Axiom.
   */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.queue.length === 0 || !this.token) {
      return;
    }

    const eventsToSend = [...this.queue];
    this.queue = [];

    const url = `https://api.axiom.co/v1/datasets/${this.dataset}/ingest`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventsToSend),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[${this.appName}] Axiom ingest failed (${response.status}): ${errorText}`,
        );
      }
    } catch (err) {
      console.error(`[${this.appName}] Error sending logs to Axiom:`, err);
    }
  }
}

export const logger = new Logger();
