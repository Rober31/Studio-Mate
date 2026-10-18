"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { LANG_LABEL, SOURCE_LABEL, STAGE_LABEL, STAGE_ORDER } from "@/lib/i18n";
import { fmtPhone } from "@/lib/format";
import { Banner, Button, Checkbox, Field, SelectField, Segmented, Sheet, TextArea, TextField, useToast } from "../ui";

export type EditableContact = {
  id: string;
  display_name: string;
  phone_e164: string | null;
  phone_raw: string | null;
  preferred_language: string | null;
  gender_form: string | null;
  owner_id: string | null;
  source: string;
  interest: string | null;
  tags: string[];
  pipeline_stage: string;
  needs_review: number;
  review_reason: string | null;
  version: number;
};

export function EditContactSheet({
  open,
  onClose,
  contact,
  staff,
  hasMembership,
}: {
  open: boolean;
  onClose: () => void;
  contact: EditableContact;
  staff: { id: string; name: string }[];
  hasMembership: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const init = () => ({
    display_name: contact.display_name,
    phone: contact.phone_e164 ? fmtPhone(contact.phone_e164) : contact.phone_raw ?? "",
    preferred_language: contact.preferred_language ?? "",
    gender_form: contact.gender_form ?? "",
    owner_id: contact.owner_id ?? "",
    source: contact.source,
    interest: contact.interest ?? "",
    tags: contact.tags.join(", "),
    pipeline_stage: contact.pipeline_stage,
    stage_reason: "",
    needs_review: contact.needs_review === 1,
  });
  const [v, setV] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; conflict?: boolean } | null>(null);
  const [dupes, setDupes] = useState<{ id: string; display_name: string }[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setV(init());
      setErrors({});
      setMessage(null);
      setDupes(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact.version]);

  const set = <K extends keyof ReturnType<typeof init>>(k: K, val: ReturnType<typeof init>[K]) => {
    setV((x) => ({ ...x, [k]: val }));
    if (errors[k as string]) setErrors((e) => ({ ...e, [k]: "" }));
  };

  const stageChanged = v.pipeline_stage !== contact.pipeline_stage;
  const needsReason =
    stageChanged && (v.pipeline_stage === "lost" || contact.pipeline_stage === "lost" || (v.pipeline_stage === "converted" && !hasMembership));
  const reasonLabel =
    contact.pipeline_stage === "lost" ? "למה פותחים מחדש?" : v.pipeline_stage === "lost" ? "סיבה לסגירה" : "אסמכתה למנוי (למשל מספר קבלה)";

  const save = async (allowDuplicate = false) => {
    setSaving(true);
    setMessage(null);
    const originalPhone = contact.phone_e164 ? fmtPhone(contact.phone_e164) : contact.phone_raw ?? "";
    try {
      await api(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        body: {
          version: contact.version,
          display_name: v.display_name,
          ...(v.phone.trim() !== originalPhone.trim() ? { phone: v.phone } : {}),
          preferred_language: v.preferred_language || null,
          gender_form: v.gender_form || null,
          owner_id: v.owner_id || null,
          source: v.source,
          interest: v.interest || null,
          tags: v.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          ...(stageChanged ? { pipeline_stage: v.pipeline_stage, stage_reason: v.stage_reason } : {}),
          needs_review: v.needs_review,
          allow_duplicate: allowDuplicate,
        },
      });
      toast("הפרטים נשמרו", "success");
      onClose();
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409 && Array.isArray(e.details?.duplicates)) setDupes(e.details!.duplicates as { id: string; display_name: string }[]);
        else if (e.status === 409) setMessage({ text: e.message, conflict: true });
        else if (e.fields) setErrors(e.fields);
        else setMessage({ text: e.message });
      } else setMessage({ text: "משהו השתבש. נסו שוב." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="עריכת פרטים"
      subtitle={contact.display_name}
      footer={
        <>
          <Button onClick={onClose}>ביטול</Button>
          <Button variant="primary" loading={saving} onClick={() => save(false)}>
            שמירה
          </Button>
        </>
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
        {message && (
          <Banner
            tone={message.conflict ? "warn" : "danger"}
            action={
              message.conflict ? (
                <Button
                  size="sm"
                  onClick={() => {
                    onClose();
                    router.refresh();
                  }}
                >
                  רענון
                </Button>
              ) : undefined
            }
          >
            {message.text}
          </Banner>
        )}
        {dupes && (
          <Banner
            tone="warn"
            action={
              <Button size="sm" onClick={() => save(true)} loading={saving}>
                לשמור בכל זאת
              </Button>
            }
          >
            המספר כבר שייך ל{dupes.map((d) => d.display_name).join(", ")}. אפשר למזג את התיקים מתפריט התיק.
          </Banner>
        )}
        <TextField label="שם" value={v.display_name} onChange={(e) => set("display_name", e.target.value)} error={errors.display_name} />
        <TextField
          label="טלפון"
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={v.phone}
          onChange={(e) => {
            set("phone", e.target.value);
            setDupes(null);
          }}
          error={errors.phone}
          autoFocus={!contact.phone_e164}
        />
        <div className="grid-2 collapse">
          <SelectField
            label="שפת קשר"
            value={v.preferred_language}
            onChange={(e) => set("preferred_language", e.target.value)}
            placeholder="ברירת המחדל של הסטודיו"
            options={Object.entries(LANG_LABEL).map(([value, label]) => ({ value, label }))}
          />
          <SelectField label="אחראי" value={v.owner_id} onChange={(e) => set("owner_id", e.target.value)} placeholder="ללא אחראי" error={errors.owner_id} options={staff.map((s) => ({ value: s.id, label: s.name }))} />
        </div>
        <Field label="לשון פנייה בהודעות" hint="אם לא ידוע — משאירים ניטרלי.">
          <Segmented
            block
            value={v.gender_form}
            onChange={(val) => set("gender_form", val)}
            options={[
              { value: "", label: "ניטרלית" },
              { value: "f", label: "נקבה" },
              { value: "m", label: "זכר" },
            ]}
          />
        </Field>
        <div className="grid-2 collapse">
          <SelectField label="מקור" value={v.source} onChange={(e) => set("source", e.target.value)} options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))} />
          <TextField label="תחום עניין" optional value={v.interest} onChange={(e) => set("interest", e.target.value)} />
        </div>
        <TextField label="תגיות" optional value={v.tags} onChange={(e) => set("tags", e.target.value)} placeholder="מופרדות בפסיק" />
        <SelectField label="שלב" value={v.pipeline_stage} onChange={(e) => set("pipeline_stage", e.target.value)} options={STAGE_ORDER.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} error={errors.pipeline_stage} />
        {(needsReason || errors.stage_reason) && (
          <TextArea label={reasonLabel} rows={2} value={v.stage_reason} onChange={(e) => set("stage_reason", e.target.value)} error={errors.stage_reason} />
        )}
        {contact.needs_review === 1 && (
          <Checkbox checked={!v.needs_review} onChange={(checked) => set("needs_review", !checked)}>
            הפרטים נבדקו ותקינים
            {contact.review_reason && (
              <span className="xsmall muted" style={{ display: "block" }}>
                סומן לבדיקה: {contact.review_reason === "duplicate_phone" ? "מספר טלפון כפול" : contact.review_reason === "missing_phone" ? "חסר טלפון" : contact.review_reason}
              </span>
            )}
          </Checkbox>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
