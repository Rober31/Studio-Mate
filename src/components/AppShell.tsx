"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Avatar, Menu, Sheet, cx } from "./ui";
import { BrandMark } from "./BrandMark";
import { ThemeMenuButton, ThemeSegmented } from "./ThemeSwitch";
import { api } from "@/lib/api";

type NavItem = { href: string; label: string; icon: string; count?: number; primary?: boolean; section?: string };

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
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const main = nav.filter((n) => !n.section);
  const manage = nav.filter((n) => n.section === "manage");
  const primary = nav.filter((n) => n.primary).slice(0, 4);
  const rest = nav.filter((n) => !primary.includes(n));
  const moreActive = rest.some((n) => isActive(n.href));
  const moreCount = rest.reduce((s, n) => s + (n.count ?? 0), 0);

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

  return (
    <div className="shell">
      <a href="#main" className="sr-only">
        דילוג לתוכן
      </a>
      <aside className="sidebar" aria-label="ניווט ראשי">
        <div className="brand">
          <BrandMark />
          <div className="grow">
            <div className="brand-name">StudioMate</div>
            <div className="brand-studio truncate">{studio.name}</div>
          </div>
        </div>
        <nav className="col" style={{ gap: 2 }}>
          {main.map((n) => (
            <Link key={n.href} href={n.href} className="nav-item" aria-current={isActive(n.href) ? "page" : undefined}>
              <Icon name={n.icon} size={19} />
              <span>{n.label}</span>
              {n.count ? <span className="nav-count num">{n.count}</span> : null}
            </Link>
          ))}
          {manage.length > 0 && <div className="nav-section">ניהול</div>}
          {manage.map((n) => (
            <Link key={n.href} href={n.href} className="nav-item" aria-current={isActive(n.href) ? "page" : undefined}>
              <Icon name={n.icon} size={19} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-theme">
            <div className="theme-switch-label">מראה</div>
            <ThemeSegmented block />
          </div>
          <Menu
            up
            trigger={(p) => (
              <button {...p} className="nav-item" style={{ width: "100%", height: 52, border: 0, background: "none", cursor: "pointer" }}>
                <Avatar name={user.name} size="sm" />
                <span className="grow" style={{ textAlign: "start", minWidth: 0 }}>
                  <span className="bold truncate" style={{ display: "block", color: "var(--text)", fontSize: 14 }}>
                    {user.name}
                  </span>
                  <span className="xsmall subtle">{user.role}</span>
                </span>
                <Icon name="more" size={18} />
              </button>
            )}
          >
            {studios.length > 1 &&
              studios
                .filter((s) => s.id !== studio.id)
                .map((s) => (
                  <button key={s.id} onClick={() => switchStudio(s.id)}>
                    <Icon name="layers" size={17} /> מעבר ל{s.name}
                  </button>
                ))}
            {studios.length > 1 && <hr />}
            <Link href="/settings?tab=account">
              <Icon name="key" size={17} /> החשבון שלי
            </Link>
            <button className="danger" onClick={logout}>
              <Icon name="logout" size={17} /> יציאה
            </button>
          </Menu>
        </div>
      </aside>

      <header className={cx("topbar", scrolled && "scrolled")}>
        <div className="row" style={{ gap: 10 }}>
          <BrandMark size={28} />
          <span className="bold">{current?.label ?? "StudioMate"}</span>
        </div>
        <div className="row" style={{ gap: 4, minWidth: 0 }}>
          <span className="xsmall subtle truncate" style={{ maxWidth: 150 }}>
            {studio.name}
          </span>
          <ThemeMenuButton />
        </div>
      </header>

      <main id="main" className="main">
        {children}
      </main>

      <nav className="tabbar" aria-label="ניווט">
        {primary.map((n) => (
          <Link key={n.href} href={n.href} className="tab" aria-current={isActive(n.href) ? "page" : undefined}>
            <Icon name={n.icon} size={23} strokeWidth={isActive(n.href) ? 2.1 : 1.8} />
            <span>{n.label.split(" ")[0]}</span>
            {n.count ? <span className="tab-badge num">{n.count}</span> : null}
          </Link>
        ))}
        <button className="tab" aria-current={moreActive ? "page" : undefined} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <Icon name="menu" size={23} />
          <span>עוד</span>
          {moreCount ? <span className="tab-badge num">{moreCount}</span> : null}
        </button>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="עוד">
        <div className="stack-4">
          <div className="list">
            {rest.map((n) => (
              <Link key={n.href} href={n.href} className="list-item">
                <Icon name={n.icon} size={20} />
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
            {studios
              .filter((s) => s.id !== studio.id)
              .map((s) => (
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
