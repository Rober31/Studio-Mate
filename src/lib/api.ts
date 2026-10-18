"use client";

export class ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
  constructor(status: number, body: { code?: string; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> }) {
    super(body.message || "משהו השתבש. נסו שוב.");
    this.status = status;
    this.code = body.code || "unknown";
    this.fields = body.fields;
    this.details = body.details;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { "x-sm-request": "1" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, { code: "network", message: "אין חיבור לאינטרנט. מה שכתבתם נשמר במסך — נסו שוב." });
  }
  const text = await res.text();
  let json: { data?: T; error?: { code?: string; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> } } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.includes("/api/auth/")) {
      window.location.href = "/login";
    }
    throw new ApiError(res.status, json.error ?? {});
  }
  return json.data as T;
}

export function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
