import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export type NormalizedPhone = { e164: string | null; valid: boolean; raw: string };

/** Normalizes a phone typed in any common format to E.164 (CRM-02, AC-01). */
export function normalizePhone(raw: string | null | undefined, defaultCountry = "IL"): NormalizedPhone {
  const value = (raw ?? "").trim();
  if (!value) return { e164: null, valid: false, raw: "" };
  const cleaned = value.replace(/[^\d+]/g, "").replace(/^00/, "+");
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry as CountryCode);
  if (!parsed) return { e164: null, valid: false, raw: value };
  return { e164: parsed.number, valid: parsed.isValid(), raw: value };
}

/** Digits-only international number for wa.me links. */
export function waNumber(e164: string): string {
  return e164.replace(/^\+/, "");
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === "IL" ? parsed.formatNational() : parsed.formatInternational();
}
