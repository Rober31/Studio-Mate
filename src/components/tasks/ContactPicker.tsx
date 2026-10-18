"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtPhone } from "@/lib/format";
import { STAGE_LABEL } from "@/lib/i18n";
import { Avatar, SearchInput, Skeleton } from "../ui";
import { Icon } from "../Icon";

export type PickedContact = { id: string; display_name: string; phone_e164: string | null; pipeline_stage?: string };

/** Search-as-you-type contact picker used inside sheets. */
export function ContactPicker({ onPick, autoFocus }: { onPick: (c: PickedContact) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickedContact[] | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<PickedContact[]>(`/api/tasks/contact-search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(setItems)
        .catch(() => {});
    }, q ? 200 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);
  return (
    <div className="stack-3">
      <SearchInput value={q} onChange={setQ} placeholder="חיפוש לפי שם או טלפון" autoFocus={autoFocus} />
      {items === null ? (
        <div className="stack-2">
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : items.length === 0 ? (
        <p className="small muted" style={{ textAlign: "center", padding: 16 }}>
          לא נמצאו לקוחות{q ? ` עבור "${q}"` : ""}
        </p>
      ) : (
        <div className="list">
          {items.map((c) => (
            <button key={c.id} type="button" className="list-item" onClick={() => onPick(c)}>
              <Avatar name={c.display_name} size="sm" />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="bold truncate" style={{ display: "block" }}>
                  {c.display_name}
                </span>
                <span className="xsmall subtle">
                  {c.phone_e164 ? <span className="ltr">{fmtPhone(c.phone_e164)}</span> : "ללא טלפון"}
                  {c.pipeline_stage ? ` · ${STAGE_LABEL[c.pipeline_stage] ?? ""}` : ""}
                </span>
              </span>
              <Icon name="chevron" size={18} className="list-chevron" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
