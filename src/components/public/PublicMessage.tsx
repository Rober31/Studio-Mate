import { Icon } from "../Icon";
import { BrandMark } from "../BrandMark";
import "@/app/sessions.css";

export function PublicMessage({ icon, title, text, note, studioName, children }: { icon: string; title: string; text: string; note?: string; studioName?: string; children?: React.ReactNode }) {
  return (
    <div className="center-screen">
      <div className="auth-card public-card" style={{ textAlign: "center" }}>
        <div className="col" style={{ alignItems: "center", gap: 14 }}>
          {studioName ? <div className="public-studio">{studioName}</div> : <BrandMark size={44} />}
          <div className="empty-icon" style={{ margin: 0 }}>
            <Icon name={icon} size={28} />
          </div>
          <h1 style={{ fontSize: 22 }}>{title}</h1>
          <p className="muted">{text}</p>
          {note && <p className="xsmall subtle">{note}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
