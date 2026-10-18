"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Menu, Segmented } from "./ui";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "sm-theme";

const OPTIONS: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: "light", label: "בהיר", icon: "sun" },
  { value: "dark", label: "כהה", icon: "moon" },
  { value: "system", label: "לפי המכשיר", icon: "device" },
];

/** Inline script for <head>: applies the saved theme before first paint (no flash). */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function readChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#0f1113" : "#f4f4f1"));
}

/** Shared theme state; every switch on the page stays in sync. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setChoice(readChoice());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onMq = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    const onSync = () => setChoice(readChoice());
    mq.addEventListener("change", onMq);
    window.addEventListener("sm-theme", onSync);
    window.addEventListener("storage", onSync);
    return () => {
      mq.removeEventListener("change", onMq);
      window.removeEventListener("sm-theme", onSync);
      window.removeEventListener("storage", onSync);
    };
  }, []);

  const set = useCallback((next: ThemeChoice) => {
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* private mode: still apply for this page */
    }
    // Brief cross-fade instead of a hard flash.
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) {
      root.classList.add("theme-transition");
      window.setTimeout(() => root.classList.remove("theme-transition"), 320);
    }
    apply(next);
    setChoice(next);
    window.dispatchEvent(new Event("sm-theme"));
  }, []);

  const resolved: "light" | "dark" = choice === "system" ? (systemDark ? "dark" : "light") : choice;
  return { choice, resolved, set };
}

/** Segmented control (desktop sidebar, settings). */
export function ThemeSegmented({ block, showLabels }: { block?: boolean; showLabels?: boolean }) {
  const { choice, set } = useTheme();
  return (
    <Segmented
      block={block}
      label="מראה"
      value={choice}
      onChange={set}
      options={OPTIONS.map((o) => ({
        value: o.value,
        label: (
          <span className="row" style={{ gap: 6 }} title={o.label}>
            <Icon name={o.icon} size={16} />
            {showLabels ? <span>{o.label}</span> : <span className="sr-only">{o.label}</span>}
          </span>
        ),
      }))}
    />
  );
}

/** Icon button with a small menu (mobile top bar). Shows the current look. */
export function ThemeMenuButton() {
  const { choice, resolved, set } = useTheme();
  return (
    <Menu
      trigger={(p) => (
        <button {...p} type="button" className="icon-btn" aria-label={`מראה: ${OPTIONS.find((o) => o.value === choice)?.label}`}>
          <Icon name={resolved === "dark" ? "moon" : "sun"} size={20} />
        </button>
      )}
    >
      {OPTIONS.map((o) => (
        <button key={o.value} role="menuitemradio" aria-checked={choice === o.value} onClick={() => set(o.value)}>
          <Icon name={o.icon} size={17} /> {o.label}
        </button>
      ))}
    </Menu>
  );
}
