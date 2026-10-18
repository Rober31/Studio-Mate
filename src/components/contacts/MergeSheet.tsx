"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { STAGE_LABEL } from "@/lib/i18n";
import { fmtPhone } from "@/lib/format";
import { Icon } from "../Icon";
import { Avatar, Banner, Button, SearchInput, Sheet, TextArea, useConfirm, useToast } from "../ui";

type C = { id: string; display_name: string; phone_e164: string | null; pipeline_stage: string; owner_name: string | null; owner_id: string | null };
type Choice = "keep" | "drop";

export function MergeSheet({ open, onClose, keep }: { open: boolean; onClose: () => void; keep: C }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<C[]>([]);
  const [searching, setSearching] = useState(false);
  const [drop, setDrop] = useState<C | null>(null);
  const [choose, setChoose] = useState<{ display_name: Choice; phone: Choice; owner: Choice }>({ display_name: "keep", phone: "keep", owner: "keep" });
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
      setDrop(null);
      setReason("");
      setError(null);
      setChoose({ display_name: "keep", phone: "keep", owner: "keep" });
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const items = await api<C[]>(`/api/contacts?q=${encodeURIComponent(q.trim())}&pageSize=10`, { signal: ctrl.signal });
        setResults(items.filter((c) => c.id !== keep.id));
      } catch {
        /* ignore aborted */
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, keep.id]);

  const submit = async () => {
    if (!drop) return;
    const ok = await confirm({
      title: "למזג את התיקים?",
      body: `התיק של "${drop.display_name}" יאוחד לתוך התיק הזה. המשימות, ההערות, המנויים והנוכחות יעברו, והתיק השני יסומן כממוזג. אי אפשר לבטל אוטומטית.`,
      confirm: "מיזוג",
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      const c = await api<{ id: string }>(`/api/contacts/${keep.id}/merge`, { body: { drop_id: drop.id, choose, reason } });
      toast("התיקים מוזגו", "success");
      onClose();
      router.replace(`/contacts/${c.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const Row = ({ field, label, a, b }: { field: keyof typeof choose; label: string; a: string; b: string }) => (
    <div className="stack-1">
      <div className="xsmall subtle bold">{label}</div>
      <div className="grid-2">
        {(["keep", "drop"] as const).map((side) => (
          <button key={side} type="button" role="radio" aria-checked={choose[field] === side} className="radio-card" onClick={() => setChoose((c) => ({ ...c, [field]: side }))}>
            <span className="radio-dot" />
            <span className="grow small truncate">{(side === "keep" ? a : b) || "—"}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="מיזוג תיקים"
      subtitle={`איחוד תיק כפול לתוך ${keep.display_name}`}
      footer={
        drop ? (
          <>
            <Button onClick={() => setDrop(null)}>חזרה</Button>
            <Button variant="danger" loading={saving} disabled={!reason.trim()} onClick={submit}>
              מיזוג
            </Button>
          </>
        ) : undefined
      }
    >
      {!drop ? (
        <div className="stack-3">
          <SearchInput value={q} onChange={setQ} placeholder="חיפוש התיק הכפול לפי שם או טלפון" autoFocus />
          {searching && <div className="small muted">מחפשים…</div>}
          {results.length > 0 && (
            <div className="list">
              {results.map((c) => (
                <button key={c.id} className="list-item" onClick={() => setDrop(c)}>
                  <Avatar name={c.display_name} size="sm" />
                  <span className="grow">
                    <span className="bold">{c.display_name}</span>
                    <span className="xsmall subtle" style={{ display: "block" }}>
                      {c.phone_e164 ? <span className="ltr">{fmtPhone(c.phone_e164)}</span> : "אין טלפון"} · {STAGE_LABEL[c.pipeline_stage]}
                    </span>
                  </span>
                  <Icon name="chevron" size={18} className="list-chevron" />
                </button>
              ))}
            </div>
          )}
          {q.trim().length >= 2 && !searching && results.length === 0 && <div className="small muted">לא נמצאו תיקים אחרים.</div>}
        </div>
      ) : (
        <div className="stack-4">
          {error && <Banner tone="danger">{error}</Banner>}
          <div className="grid-2">
            <div className="card card-pad" style={{ padding: 12 }}>
              <div className="xsmall subtle">נשאר</div>
              <div className="bold truncate">{keep.display_name}</div>
            </div>
            <div className="card card-pad" style={{ padding: 12, background: "var(--surface-2)" }}>
              <div className="xsmall subtle">יאוחד ויסומן כממוזג</div>
              <div className="bold truncate">{drop.display_name}</div>
            </div>
          </div>
          <p className="small muted">בחרו אילו ערכים לשמור:</p>
          <Row field="display_name" label="שם" a={keep.display_name} b={drop.display_name} />
          <Row field="phone" label="טלפון" a={keep.phone_e164 ? fmtPhone(keep.phone_e164) : ""} b={drop.phone_e164 ? fmtPhone(drop.phone_e164) : ""} />
          <Row field="owner" label="אחראי" a={keep.owner_name ?? "ללא אחראי"} b={drop.owner_name ?? "ללא אחראי"} />
          <Banner tone="info">משימות, הערות, מנויים, נוכחות והיסטוריה יעברו לתיק שנשאר. חסימת קשר באחד התיקים תישאר בתוקף.</Banner>
          <TextArea label="סיבה למיזוג" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: אותו אדם נרשם פעמיים" />
        </div>
      )}
    </Sheet>
  );
}
