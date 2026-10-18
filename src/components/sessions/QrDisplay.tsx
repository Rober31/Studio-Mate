"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { api, ApiError } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { Icon } from "../Icon";
import { BrandMark } from "../BrandMark";
import { Button, IconButton } from "../ui";
import "@/app/sessions.css";

type Challenge = {
  token: string;
  expires_at: string;
  rotate_seconds: number;
  slug: string;
  window: { opensAt: string; closesAt: string };
  session: { id: string; title: string; start_at: string; end_at: string; status: string; attendance_count: number };
};

const R = 26;
const CIRC = 2 * Math.PI * R;

export function QrDisplay({ sessionId, studioName, tz, initialTitle, initialStart }: { sessionId: string; studioName: string; tz: string; initialTitle: string; initialStart: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [left, setLeft] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const [bump, setBump] = useState(false);
  const [stopped, setStopped] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCount = useRef<number | null>(null);

  const issue = useCallback(async () => {
    try {
      const c = await api<Challenge>(`/api/sessions/${sessionId}/qr-challenges`, { method: "POST" });
      const url = `${window.location.origin}/s/${c.slug}/checkin?t=${encodeURIComponent(c.token)}`;
      const markup = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#16191d", light: "#ffffff" } });
      setSwapping(true);
      setTimeout(() => {
        setSvg(markup);
        setSwapping(false);
      }, 180);
      setChallenge(c);
      setLeft(c.rotate_seconds);
      setOffline(false);
      setStopped(null);
      timer.current = setTimeout(issue, c.rotate_seconds * 1000);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 0) {
        // No connection: hide the code (an expired code would mislead) and retry.
        setOffline(true);
        setSvg(null);
        timer.current = setTimeout(issue, 5000);
      } else {
        setSvg(null);
        setStopped(err.message);
      }
    }
  }, [sessionId]);

  useEffect(() => {
    issue();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [issue]);

  // Countdown ring.
  useEffect(() => {
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // Live attendance counter.
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await api<{ count: number }>(`/api/sessions/${sessionId}/roster`);
        if (lastCount.current !== null && r.count > lastCount.current) {
          setBump(true);
          setTimeout(() => setBump(false), 500);
        }
        lastCount.current = r.count;
        setCount(r.count);
      } catch {
        /* ignore */
      }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, [sessionId]);

  // Keep the screen awake when supported.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => {
      lock?.release().catch(() => {});
    };
  }, []);

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const title = challenge?.session.title ?? initialTitle;
  const start = challenge?.session.start_at ?? initialStart;
  const total = challenge?.rotate_seconds ?? 60;
  const outsideWindow = challenge && (Date.now() < Date.parse(challenge.window.opensAt) || Date.now() > Date.parse(challenge.window.closesAt));

  return (
    <div className="display-screen">
      <div className="display-top">
        <div className="row" style={{ gap: 10 }}>
          <BrandMark size={34} />
          <span className="bold">{studioName}</span>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <IconButton icon="expand" label="מסך מלא" onClick={fullscreen} />
          <Link href={`/sessions/${sessionId}`} className="icon-btn" aria-label="סגירה">
            <Icon name="close" size={20} />
          </Link>
        </div>
      </div>

      <div className="display-center">
        <div>
          <div className="display-title">{title}</div>
          <div className="display-sub num">{fmtTime(start, tz)}</div>
        </div>

        {stopped ? (
          <div className="card card-pad" style={{ maxWidth: 460 }}>
            <div className="col" style={{ alignItems: "center", gap: 10 }}>
              <Icon name="pause" size={34} />
              <div className="bold" style={{ fontSize: 20 }}>
                הרישום לשיעור סגור
              </div>
              <p className="muted">{stopped}</p>
              <Link href={`/sessions/${sessionId}`} className="btn">
                חזרה לשיעור
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="qr-frame" aria-live="polite">
              {svg ? (
                <div className={`qr-svg${swapping ? " swapping" : ""}`} role="img" aria-label="קוד QR לרישום נוכחות" dangerouslySetInnerHTML={{ __html: svg }} />
              ) : (
                <div className="qr-placeholder">
                  {offline ? (
                    <div className="col" style={{ alignItems: "center", gap: 8 }}>
                      <Icon name="alert" size={30} />
                      <span>אין חיבור לאינטרנט. מנסים שוב…</span>
                    </div>
                  ) : (
                    <span className="spinner" />
                  )}
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 18, justifyContent: "center", flexWrap: "wrap" }}>
              <div className="row" style={{ gap: 10 }}>
                <svg width="64" height="64" viewBox="0 0 64 64" className="ring" aria-hidden>
                  <circle cx="32" cy="32" r={R} fill="none" stroke="var(--line-strong)" strokeWidth="5" />
                  <circle cx="32" cy="32" r={R} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - left / total)} />
                </svg>
                <div style={{ textAlign: "start" }}>
                  <div className="bold num">{left} שנ׳</div>
                  <div className="xsmall subtle">הקוד מתחלף</div>
                </div>
              </div>
              <div style={{ textAlign: "start" }}>
                <div className={`display-count${bump ? " count-bump" : ""}`}>{count ?? "–"}</div>
                <div className="xsmall subtle">נרשמו לשיעור</div>
              </div>
            </div>
            <p className="display-sub" style={{ fontSize: 18 }}>
              סרקו עם המצלמה בטלפון כדי לרשום נוכחות
            </p>
            {outsideWindow && challenge && (
              <p className="small" style={{ color: "var(--orange)" }}>
                סריקה עצמית פתוחה בין {fmtTime(challenge.window.opensAt, tz)} ל-{fmtTime(challenge.window.closesAt, tz)}.
              </p>
            )}
          </>
        )}
      </div>

      <div className="xsmall subtle">
        טלפון שעדיין לא חובר? בקשו קישור חיבור בקבלה.{" "}
        {!stopped && (
          <Button size="sm" variant="ghost" onClick={() => { if (timer.current) clearTimeout(timer.current); issue(); }}>
            קוד חדש
          </Button>
        )}
      </div>
    </div>
  );
}
