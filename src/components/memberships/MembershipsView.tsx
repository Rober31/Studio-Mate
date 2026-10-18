"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { MEMBERSHIP_STATUS_LABEL, MEMBERSHIP_STATUS_TONE, PLAN_TYPE_LABEL } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { Icon } from "../Icon";
import { Avatar, Badge, Banner, Button, EmptyState, Field, RadioCards, SearchInput, Sheet, Skeleton, Switch, Tabs, TextField, useToast } from "../ui";
import { ContactPicker, type PickedContact } from "../tasks/ContactPicker";
import { MembershipDetailSheet } from "./MembershipDetailSheet";
import { MembershipSheet, planSummary, type PlanRow } from "./MembershipSheet";

type Item = {
  id: string;
  contact_id: string;
  contact_name?: string;
  plan_name: string;
  plan_type: string;
  authority: string;
  status: string;
  ends_at: string | null;
  starts_at: string;
  balance: number | null;
};

const FILTERS: { value: string; label: string }[] = [
  { value: "active", label: "פעילים" },
  { value: "ending", label: "מסתיימים בקרוב" },
  { value: "paused", label: "מוקפאים" },
  { value: "exhausted", label: "היתרה נגמרה" },
  { value: "pending", label: "מתחילים בעתיד" },
  { value: "expired", label: "הסתיימו" },
  { value: "cancelled", label: "בוטלו" },
  { value: "", label: "הכל" },
];

export function MembershipsView({
  initialTab,
  initial,
  plans: initialPlans,
  tz,
  canManage,
}: {
  initialTab: "memberships" | "plans";
  initial: { items: Item[]; total: number };
  plans: PlanRow[];
  tz: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [plans, setPlans] = useState(initialPlans);
  const switchTab = (t: "memberships" | "plans") => {
    setTab(t);
    router.replace(t === "plans" ? "/memberships?tab=plans" : "/memberships", { scroll: false });
  };
  const reloadPlans = async () => setPlans(await api<PlanRow[]>("/api/plans?all=1"));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">מנויים</h1>
          <p className="page-sub">מסלולים, מנויים, יתרות והקפאות</p>
        </div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <Tabs
          label="תצוגה"
          value={tab}
          onChange={switchTab}
          tabs={[
            { value: "memberships", label: "מנויים" },
            { value: "plans", label: `מסלולים (${plans.filter((p) => p.active).length})` },
          ]}
        />
      </div>
      {tab === "memberships" ? (
        <MembershipList initial={initial} tz={tz} canManage={canManage} hasPlans={plans.some((p) => p.active)} onGoPlans={() => switchTab("plans")} />
      ) : (
        <PlansPanel plans={plans} canManage={canManage} onChanged={reloadPlans} />
      )}
    </div>
  );
}

function endLabel(m: Item, tz: string) {
  if (!m.ends_at) return "ללא סיום";
  return fmtDate(new Date(Date.parse(m.ends_at) - 1).toISOString(), tz, { day: "numeric", month: "short", year: "numeric" });
}

function MembershipList({ initial, tz, canManage, hasPlans, onGoPlans }: { initial: { items: Item[]; total: number }; tz: string; canManage: boolean; hasPlans: boolean; onGoPlans: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState<PickedContact | null>(null);
  const first = useRef(true);

  const load = useCallback(
    async (p = 1) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/memberships?status=${status}&q=${encodeURIComponent(q)}&page=${p}`, { headers: { "x-sm-request": "1" } });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message ?? "שגיאה");
        setData((prev) => ({ items: p === 1 ? json.data : [...prev.items, ...json.data], total: json.meta.total }));
        setPage(p);
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setLoading(false);
      }
    },
    [status, q, toast],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => load(1), q ? 220 : 0);
    return () => clearTimeout(t);
  }, [status, q, load]);

  return (
    <div className="stack-4">
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <SearchInput value={q} onChange={setQ} placeholder="חיפוש לפי שם" />
        </div>
        {canManage && (
          <Button variant="primary" icon="plus" onClick={() => (hasPlans ? setPicking(true) : onGoPlans())}>
            מנוי חדש
          </Button>
        )}
      </div>
      <div className="chips" role="group" aria-label="סינון לפי מצב">
        {FILTERS.map((f) => (
          <button key={f.value} className="chip" aria-pressed={status === f.value} onClick={() => setStatus(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading && data.items.length === 0 ? (
        <div className="stack-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={60} radius={14} />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="card"
            title={q ? "לא נמצאו מנויים" : status ? "אין מנויים במצב הזה" : "עדיין אין מנויים"}
            text={!hasPlans ? "כדי ליצור מנויים צריך קודם להגדיר מסלול." : q ? "נסו שם אחר." : undefined}
            action={
              canManage && !hasPlans ? (
                <Button variant="primary" onClick={onGoPlans}>
                  הגדרת מסלול
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="card hide-mobile" style={{ overflow: "hidden" }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>לקוח/ה</th>
                    <th>מסלול</th>
                    <th>מצב</th>
                    <th>סיום</th>
                    <th>יתרה</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((m) => (
                    <tr key={m.id} className="clickable" onClick={() => setDetail(m.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setDetail(m.id)}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <Avatar name={m.contact_name ?? "?"} size="sm" />
                          <span className="bold">{m.contact_name}</span>
                        </div>
                      </td>
                      <td>
                        {m.plan_name}
                        {m.authority === "external" && (
                          <span className="xsmall subtle" style={{ marginInlineStart: 6 }}>
                            · חיצוני
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge tone={MEMBERSHIP_STATUS_TONE[m.status]} dot>
                          {MEMBERSHIP_STATUS_LABEL[m.status]}
                        </Badge>
                      </td>
                      <td className="num">{endLabel(m, tz)}</td>
                      <td className="num">{m.balance === null ? <span className="subtle">—</span> : <BalanceChip n={m.balance} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="list hide-desktop">
            {data.items.map((m) => (
              <button key={m.id} className="list-item" onClick={() => setDetail(m.id)}>
                <Avatar name={m.contact_name ?? "?"} size="sm" />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="bold truncate" style={{ display: "block" }}>
                    {m.contact_name}
                  </span>
                  <span className="xsmall subtle truncate" style={{ display: "block" }}>
                    {m.plan_name} · עד {endLabel(m, tz)}
                  </span>
                </span>
                <span className="col" style={{ alignItems: "flex-end", gap: 4 }}>
                  <Badge tone={MEMBERSHIP_STATUS_TONE[m.status]}>{MEMBERSHIP_STATUS_LABEL[m.status]}</Badge>
                  {m.balance !== null && <BalanceChip n={m.balance} />}
                </span>
              </button>
            ))}
          </div>
          {data.items.length < data.total && (
            <Button block onClick={() => load(page + 1)} loading={loading}>
              עוד ({data.total - data.items.length})
            </Button>
          )}
        </>
      )}

      <MembershipDetailSheet membershipId={detail} open={!!detail} onClose={() => setDetail(null)} onChanged={() => load(1)} />
      <Sheet open={picking} onClose={() => setPicking(false)} title="מנוי חדש" subtitle="למי?">
        <ContactPicker
          autoFocus
          onPick={(c) => {
            setPicking(false);
            setCreating(c);
          }}
        />
      </Sheet>
      {creating && (
        <MembershipSheet open={!!creating} onClose={() => setCreating(null)} contactId={creating.id} contactName={creating.display_name} onDone={() => load(1)} />
      )}
    </div>
  );
}

function BalanceChip({ n }: { n: number }) {
  const tone = n <= 0 ? "red" : n <= 2 ? "orange" : "gray";
  return (
    <Badge tone={tone}>
      <Icon name="wallet" size={13} /> {n}
    </Badge>
  );
}

// ---------------------------------------------------------------- Plans

const TYPE_HINT: Record<string, string> = {
  period: "זכאות לכל השיעורים בתקופה (למשל חודש). לא יורדים שיעורים.",
  punch: "מספר שיעורים קבוע. כל נוכחות מורידה שיעור אחד. אפשר בלי תאריך תפוגה.",
  punch_period: "מספר שיעורים שצריך לנצל בתוך תקופה מוגדרת.",
  trial: "שיעור ניסיון חד-פעמי למתעניינים חדשים.",
};

function PlansPanel({ plans, canManage, onChanged }: { plans: PlanRow[]; canManage: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<PlanRow | "new" | null>(null);
  const toggle = async (p: PlanRow) => {
    try {
      await api(`/api/plans/${p.id}`, { method: "PATCH", body: { ...p, active: !p.active } });
      toast(p.active ? "המסלול הועבר ללא פעיל" : "המסלול הופעל", "success");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <div className="stack-4">
      <div className="row between wrap">
        <p className="small muted">המחיר הוא לתיעוד בלבד — StudioMate אינו מערכת גבייה.</p>
        {canManage && (
          <Button variant="primary" icon="plus" onClick={() => setEdit("new")}>
            מסלול חדש
          </Button>
        )}
      </div>
      {plans.length === 0 ? (
        <div className="card">
          <EmptyState icon="card" title="עדיין אין מסלולים" text="הגדירו את סוגי המנויים בסטודיו: מנוי חודשי, כרטיסייה או שיעור ניסיון." />
        </div>
      ) : (
        <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
          {plans.map((p) => (
            <div key={p.id} className="card card-pad stack-2" style={{ opacity: p.active ? 1 : 0.6 }}>
              <div className="row between start">
                <div style={{ minWidth: 0 }}>
                  <div className="bold truncate" style={{ fontSize: 17 }}>
                    {p.name}
                  </div>
                </div>
                {canManage && <Switch checked={!!p.active} onChange={() => toggle(p)} label={p.active ? "פעיל" : "לא פעיל"} />}
              </div>
              <div className="small muted">{planSummary(p)}</div>
              <div className="row between">
                <span className="bold num">{p.price ? `₪${p.price}` : <span className="subtle small">ללא מחיר</span>}</span>
                {canManage && (
                  <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(p)}>
                    עריכה
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <PlanSheet plan={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />
    </div>
  );
}

function PlanSheet({ plan, onClose, onSaved }: { plan: PlanRow | "new" | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<PlanRow["type"] | null>(null);
  const [sessions, setSessions] = useState("");
  const [validity, setValidity] = useState("");
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!plan) return;
    const p = plan === "new" ? null : plan;
    setName(p?.name ?? "");
    setType(p?.type ?? null);
    setSessions(p?.sessions_granted ? String(p.sessions_granted) : "");
    setValidity(p?.validity_days ? String(p.validity_days) : "");
    setPrice(p?.price ?? "");
    setErrors({});
    setMessage(null);
  }, [plan]);

  const needsSessions = type === "punch" || type === "punch_period";
  const needsValidity = type === "period" || type === "punch_period" || type === "trial";
  const save = async () => {
    setSaving(true);
    setErrors({});
    setMessage(null);
    const body = {
      name,
      type,
      sessions_granted: needsSessions ? Number(sessions) || null : type === "trial" ? 1 : null,
      validity_days: validity ? Number(validity) : null,
      price: price.trim() || null,
      active: plan === "new" || !plan ? true : !!plan.active,
    };
    try {
      if (plan === "new") await api("/api/plans", { body });
      else if (plan) await api(`/api/plans/${plan.id}`, { method: "PATCH", body });
      toast("המסלול נשמר", "success");
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setMessage(e instanceof ApiError && e.fields ? null : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={!!plan}
      onClose={onClose}
      title={plan === "new" ? "מסלול חדש" : "עריכת מסלול"}
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            שמירה
          </Button>
        </>
      }
    >
      <div className="stack-4">
        {message && <Banner tone="danger">{message}</Banner>}
        <TextField label="שם המסלול" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="למשל: כרטיסייה 10 שיעורים" autoFocus />
        <Field label="סוג" error={errors.type}>
          <RadioCards
            value={type}
            onChange={(v) => setType(v)}
            options={(["period", "punch", "punch_period", "trial"] as const).map((t) => ({ value: t, label: PLAN_TYPE_LABEL[t], hint: TYPE_HINT[t] }))}
          />
        </Field>
        {type && (
          <div className="grid-2 fade-in">
            {needsSessions && (
              <TextField label="מספר שיעורים" type="number" inputMode="numeric" min={1} value={sessions} onChange={(e) => setSessions(e.target.value)} error={errors.sessions_granted} />
            )}
            {(needsValidity || type === "punch") && (
              <TextField
                label="תוקף בימים"
                type="number"
                inputMode="numeric"
                min={1}
                optional={type === "punch"}
                value={validity}
                onChange={(e) => setValidity(e.target.value)}
                error={errors.validity_days}
                hint={type === "period" ? "למשל 30 לחודש" : undefined}
              />
            )}
            <TextField label="מחיר (₪)" optional inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} hint="לתיעוד בלבד" />
          </div>
        )}
        {plan !== "new" && plan && <Banner tone="info">שינוי המסלול חל על מנויים חדשים. מנויים קיימים שומרים על התאריכים והיתרה שלהם.</Banner>}
      </div>
    </Sheet>
  );
}
