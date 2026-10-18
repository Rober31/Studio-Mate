"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { LANG_LABEL, SOURCE_LABEL, STAGE_LABEL } from "@/lib/i18n";
import { Banner, Button, SelectField, Sheet, TextArea, TextField, useToast } from "../ui";
import { Icon } from "../Icon";

type Dupe = { id: string; display_name: string; pipeline_stage: string };

const EMPTY = { display_name: "", phone: "", preferred_language: "", owner_id: "", source: "manual", interest: "", tags: "", note: "" };

export function NewContactSheet({ open, onClose, staff, me }: { open: boolean; onClose: () => void; staff: { id: string; name: string }[]; me: string }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState({ ...EMPTY, owner_id: me });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [dupes, setDupes] = useState<Dupe[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setV({ ...EMPTY, owner_id: me });
      setErrors({});
      setMessage(null);
      setDupes(null);
    }
  }, [open, me]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setV((x) => ({ ...x, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: "" }));
    if (k === "phone") setDupes(null);
  };

  const save = async (allowDuplicate = false) => {
    setSaving(true);
    setMessage(null);
    try {
      const c = await api<{ id: string }>("/api/contacts", {
        body: {
          display_name: v.display_name,
          phone: v.phone,
          preferred_language: v.preferred_language || null,
          owner_id: v.owner_id || null,
          source: v.source,
          interest: v.interest || null,
          tags: v.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          note: v.note || undefined,
          allow_duplicate: allowDuplicate,
        },
      });
      toast(allowDuplicate ? "הלקוח נוסף וסומן לבדיקה" : "הלקוח נוסף", "success");
      onClose();
      router.push(`/contacts/${c.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409 && Array.isArray(e.details?.duplicates)) setDupes(e.details!.duplicates as Dupe[]);
        else if (e.fields) setErrors(e.fields);
        else setMessage(e.message);
      } else setMessage("משהו השתבש. נסו שוב.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="לקוח חדש"
      footer={
        dupes ? undefined : (
          <>
            <Button onClick={onClose}>ביטול</Button>
            <Button variant="primary" loading={saving} onClick={() => save(false)} disabled={!v.display_name.trim()}>
              הוספה
            </Button>
          </>
        )
      }
    >
      <form
        className="stack-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
      >
        {message && <Banner tone="danger">{message}</Banner>}
        {dupes && (
          <div className="stack-3 fade-in">
            <Banner tone="warn">כבר יש לקוח עם מספר הטלפון הזה. כדי לא ליצור כפילות — כדאי לפתוח את התיק הקיים.</Banner>
            <div className="list">
              {dupes.map((d) => (
                <Link key={d.id} href={`/contacts/${d.id}`} className="list-item" onClick={onClose}>
                  <Icon name="person" size={18} />
                  <span className="grow">
                    <span className="bold">{d.display_name}</span>
                    <span className="xsmall subtle" style={{ display: "block" }}>
                      {STAGE_LABEL[d.pipeline_stage] ?? d.pipeline_stage}
                    </span>
                  </span>
                  <span className="small" style={{ color: "var(--accent)" }}>
                    פתיחת התיק הקיים
                  </span>
                </Link>
              ))}
            </div>
            <div className="row wrap">
              <Button onClick={() => setDupes(null)}>חזרה לעריכה</Button>
              <Button variant="ghost" loading={saving} onClick={() => save(true)}>
                ליצור בכל זאת (יסומן לבדיקה)
              </Button>
            </div>
          </div>
        )}
        {!dupes && (
          <>
            <TextField label="שם" autoFocus autoComplete="off" value={v.display_name} onChange={set("display_name")} error={errors.display_name} />
            <TextField
              label="טלפון"
              type="tel"
              inputMode="tel"
              dir="ltr"
              autoComplete="off"
              value={v.phone}
              onChange={set("phone")}
              error={errors.phone}
              hint="צריך מספר תקין כדי לשלוח וואטסאפ"
              placeholder="050-1234567"
            />
            <div className="grid-2 collapse">
              <SelectField
                label="שפת קשר"
                optional
                value={v.preferred_language}
                onChange={set("preferred_language")}
                placeholder="ברירת המחדל של הסטודיו"
                options={Object.entries(LANG_LABEL).map(([value, label]) => ({ value, label }))}
              />
              <SelectField
                label="אחראי"
                value={v.owner_id}
                onChange={set("owner_id")}
                placeholder="ללא אחראי"
                error={errors.owner_id}
                options={staff.map((s) => ({ value: s.id, label: s.name }))}
              />
            </div>
            <div className="grid-2 collapse">
              <SelectField label="מקור" value={v.source} onChange={set("source")} options={Object.entries(SOURCE_LABEL).filter(([k]) => k !== "import" && k !== "qr").map(([value, label]) => ({ value, label }))} />
              <TextField label="תחום עניין" optional value={v.interest} onChange={set("interest")} placeholder="למשל: פילאטיס מכשירים" />
            </div>
            <TextField label="תגיות" optional value={v.tags} onChange={set("tags")} placeholder="מופרדות בפסיק" />
            <TextArea label="הערה" optional rows={3} value={v.note} onChange={set("note")} hint="לא כותבים כאן מידע רפואי." />
            <button type="submit" hidden />
          </>
        )}
      </form>
    </Sheet>
  );
}
