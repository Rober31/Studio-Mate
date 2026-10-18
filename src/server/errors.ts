export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "unavailable"
  | "blocked";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 422,
  blocked: 422,
  rate_limited: 429,
  unavailable: 503,
};

/** Error with a user-facing Hebrew message and optional field errors. */
export class AppError extends Error {
  code: ErrorCode;
  status: number;
  fields?: Record<string, string>;
  details?: unknown;
  constructor(code: ErrorCode, message: string, opts?: { fields?: Record<string, string>; details?: unknown }) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.fields = opts?.fields;
    this.details = opts?.details;
  }
}

export const notFound = (what = "הפריט") => new AppError("not_found", `${what} לא נמצא או שאין לך גישה אליו.`);
export const forbidden = () => new AppError("forbidden", "אין לך הרשאה לפעולה הזו.");
export const conflict = (message = "מישהו אחר עדכן את הפריט בינתיים. רעננו ונסו שוב.", details?: unknown) =>
  new AppError("conflict", message, { details });
export const invalid = (fields: Record<string, string>, message = "יש לתקן כמה שדות.") =>
  new AppError("validation", message, { fields });
