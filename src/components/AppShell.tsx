"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Avatar, Menu, Sheet, cx } from "./ui";
import { BrandMark } from "./BrandMark";
import { ThemeMenuButton, ThemePill } from "./ThemeSwitch";
import { api } from "@/lib/api";

type NavItem = { href: string; label: string; icon: string; count?: number; primary?: boolean; section?: string };

// Shorter labels for the top navigation pill; full labels stay in menus.
const SHORT: Record<string, string> = {
  "/sessions": "שיעורים",
  "/registrations": "הרשמות",
  "/imports": "ייבוא",
  "/audit": "יומן",
};

/** Sliding active indicator inside the navigation pill. */
function useIndicator(ref: React.RefObject<HTMLElement | null>, key: string) {
  const [style, setStyle] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>('[data-active="true"]');
      if (!active) return setStyle(null);
      const p = el.getBoundingClientRect();
      const r = active.getBoundingClientRect();
      setStyle({ left: r.left - p.left, width: r.width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [ref, key]);
  return style;
}

export function AppShell({
  nav,
  user,
  studio,
  studios,
  children,
}: {
  nav: NavItem[];
  user: { name: string; email: string; role: string };
  studio: { id: string; name: string };
  studios: { id: string; name: string }[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const main = nav.filter((n) => !n.section);
  const manage = nav.filter((n) => n.section === "manage");
  const manageActive = manage.some((n) => isActive(n.href));
  const primary = nav.filter((n) => n.primary).slice(0, 4);
  const rest = nav.filter((n) => !primary.includes(n));
  const moreActive = rest.some((n) => isActive(n.href));
  const moreCount = rest.reduce((s, n) => s + (n.count ?? 0), 0);
  const indicator = useIndicator(navRef, pathname);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setMoreOpen(false), [pathname]);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  };
  const switchStudio = async (id: string) => {
    await api("/api/auth/switch", { body: { studio_id: id } });
    router.refresh();
    window.location.href = "/";
  };

  const current = nav.find((n) => isActive(n.href));
  const otherStudios = studios.filter((s) => s.id !== studio.id);

  const userMenu = (
    <>
      <div className="menu-head">
        <div className="bold truncate">{user.name}</div>
        <div className="xsmall subtle truncate">
          {user.role} · {studio.name}
        </div>
      </div>
      <hr />
      {otherStudios.map((s) => (
        <button key={s.id} onClick={() => switchStudio(s.id)}>
          <Icon name="layers" size={17} /> מעבר ל{s.name}
        </button>
      ))}
      {otherStudios.length > 0 && <hr />}
      <Link href="/settings?tab=account">
        <Icon name="key" size={17} /> החשבון שלי
      </Link>
      <button className="danger" onClick={logout}>
        <Icon name="logout" size={17} /> יציאה
      </button>
    </>
  );

  return (
    <div className="shell">
      <a href="#main" className="sr-only">
        דילוג לתוכן
      </a>

      {/* Desktop: horizontal top bar with a pill navigation (no sidebar) */}
      <header className={cx("appbar", scrolled && "scrolled")}>
        <div className="appbar-inner">
          <Link href="/" className="appbar-brand" aria-label="StudioMate · דף הבית">
            <BrandMark size={34} />
            <div className="appbar-brand-text">
              <div className="brand-name">StudioMate</div>
              <div className="brand-studio truncate">{studio.name}</div>
            </div>
          </Link>

          <nav ref={navRef} className="navpill" aria-label="ניווט ראשי">
            {indicator && <span className="navpill-indicator" style={{ left: indicator.left, width: indicator.width }} aria-hidden />}
            {main.map((n) => {
              const active = isActive(n.href);
              return (
                <Link key={n.href} href={n.href} className="navpill-item" data-active={active} aria-current={active ? "page" : undefined}>
                  {active && <Icon name={n.icon} size={16} />}
                  <span>{SHORT[n.href] ?? n.label}</span>
                  {n.count ? <span className="navpill-count num">{n.count}</span> : null}
                </Link>
              );
            })}
            {manage.length > 0 && (
              <Menu
                trigger={(p) => (
                  <button {...p} type="button" className="navpill-item" data-active={manageActive}>
                    {manageActive && <Icon name={manage.find((n) => isActive(n.href))?.icon ?? "settings"} size={16} />}
                    <span>{manageActive ? SHORT[manage.find((n) => isActive(n.href))!.href] ?? manage.find((n) => isActive(n.href))!.label : "ניהול"}</span>
                    <Icon name="chevronDown" size={14} />
                  </button>
                )}
              >
                {manage.map((n) => (
                  <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined}>
                    <Icon name={n.icon} size={17} /> {n.label}
                  </Link>
                ))}
              </Menu>
            )}
          </nav>

          <div className="appbar-actions">
            <ThemePill />
            <Menu
              trigger={(p) => (
                <button {...p} type="button" className="appbar-user">
                  <Avatar name={user.name} size="sm" />
                  <span className="appbar-user-name truncate">{user.name}</span>
                  <Icon name="chevronDown" size={15} />
                </button>
              )}
            >
              {userMenu}
            </Menu>
          </div>
        </div>
      </header>

      {/* Mobile top bar */}
      <header className={cx("topbar", scrolled && "scrolled")}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <BrandMark size={30} />
          <div style={{ minWidth: 0 }}>
            <div className="bold truncate" style={{ lineHeight: 1.2 }}>
              {current?.label ?? "StudioMate"}
            </div>
            <div className="xsmall subtle truncate">{studio.name}</div>
          </div>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <ThemeMenuButton />
          <Menu
            trigger={(p) => (
              <button {...p} type="button" className="icon-btn" aria-label="החשבון שלי">
                <Avatar name={user.name} size="sm" />
              </button>
            )}
          >
            {userMenu}
          </Menu>
        </div>
      </header>

      <main id="main" className="main">
        {children}
      </main>

      {/* Mobile: floating tab bar */}
      <nav className="tabbar" aria-label="ניווט">
        {primary.map((n) => (
          <Link key={n.href} href={n.href} className="tab" aria-current={isActive(n.href) ? "page" : undefined}>
            <span className="tab-icon">
              <Icon name={n.icon} size={21} strokeWidth={isActive(n.href) ? 2.1 : 1.8} />
            </span>
            <span className="tab-label">{SHORT[n.href] ?? n.label.split(" ")[0]}</span>
            {n.count ? <span className="tab-badge num">{n.count}</span> : null}
          </Link>
        ))}
        <button className="tab" aria-current={moreActive ? "page" : undefined} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <span className="tab-icon">
            <Icon name="menu" size={21} />
          </span>
          <span className="tab-label">עוד</span>
          {moreCount ? <span className="tab-badge num">{moreCount}</span> : null}
        </button>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="עוד">
        <div className="stack-4">
          <div className="list">
            {rest.map((n) => (
              <Link key={n.href} href={n.href} className="list-item">
                <span className="icon-chip">
                  <Icon name={n.icon} size={18} />
                </span>
                <span className="grow bold">{n.label}</span>
                {n.count ? <span className="nav-count num">{n.count}</span> : null}
                <Icon name="chevron" size={18} className="list-chevron" />
              </Link>
            ))}
          </div>
          <div className="list">
            <div className="list-item">
              <Avatar name={user.name} size="sm" />
              <div className="grow">
                <div className="bold">{user.name}</div>
                <div className="xsmall subtle">
                  {user.role} · {studio.name}
                </div>
              </div>
            </div>
            {otherStudios.map((s) => (
              <button key={s.id} className="list-item" onClick={() => switchStudio(s.id)}>
                <Icon name="layers" size={20} />
                <span className="grow">מעבר ל{s.name}</span>
              </button>
            ))}
            <button className="list-item" onClick={logout} style={{ color: "var(--red)" }}>
              <Icon name="logout" size={20} />
              <span className="grow bold">יציאה</span>
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
