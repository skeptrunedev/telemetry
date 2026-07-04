import { useState } from "react";
import { rawFetch } from "./api";

type PhoneInfo = {
  phone: string;
  linkedChannel: { userEmail: string; verified: boolean } | null;
  authUser: { email: string; name: string; tempAccount: boolean } | null;
  photon: { id: string; assignedNumber: string | null } | null;
  photonError: string | null;
  pendingTextMe: number;
  accountEmail: string | null;
  counts: Record<string, number> | null;
};

// Admin-only: inspect a phone number across every system that knows it, and
// reset it so onboarding can be tested again from scratch.
export function Admin({ onClose }: { onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [report, setReport] = useState<string[] | null>(null);
  const [wipe, setWipe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function inspect() {
    setBusy(true);
    setErr(null);
    setReport(null);
    try {
      const r = await rawFetch(`/api/admin/phone?number=${encodeURIComponent(phone.trim())}`);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `inspect → ${r.status}`);
      setInfo(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setInfo(null);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!info) return;
    if (!confirm(`Reset ${info.phone} everywhere${wipe ? " AND wipe its temp account" : ""}?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await rawFetch(`/api/admin/phone/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: info.phone, wipeAccount: wipe }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `reset → ${r.status}`);
      setReport(body.report);
      setInfo(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet mcp-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="mcp-title">Admin — reset a number</h2>
        <p className="meta">
          Kills a phone number everywhere (Photon registration, linked channel, phone sign-in, onboarding
          queue) so you can run onboarding again from scratch. Wiping deletes temp phone-signup accounts
          only — real accounts just lose the number.
        </p>

        <div className="admin-row">
          <input
            type="tel"
            inputMode="tel"
            placeholder="(415) 555-0132"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            aria-label="Phone number"
          />
          <button className="btn" onClick={inspect} disabled={busy || !phone.trim()}>
            {busy ? "…" : "Inspect"}
          </button>
        </div>

        {info && (
          <div className="admin-info">
            <ul>
              <li>
                Linked channel:{" "}
                {info.linkedChannel
                  ? `${info.linkedChannel.userEmail} ${info.linkedChannel.verified ? "(verified)" : "(unverified)"}`
                  : "none"}
              </li>
              <li>
                Phone sign-in:{" "}
                {info.authUser
                  ? `${info.authUser.email}${info.authUser.tempAccount ? " (temp account)" : ""}`
                  : "none"}
              </li>
              <li>
                Photon:{" "}
                {info.photon
                  ? `registered, assigned ${info.photon.assignedNumber ?? "?"}`
                  : (info.photonError ?? "not registered")}
              </li>
              <li>Onboarding queue rows: {info.pendingTextMe}</li>
              {info.counts && (
                <li>
                  Account data ({info.accountEmail}): {info.counts.weights} weights · {info.counts.meals}{" "}
                  meals · {info.counts.workouts} workouts · {info.counts.measurements} measurements ·{" "}
                  {info.counts.memories} memories
                </li>
              )}
            </ul>
            <label className="admin-wipe">
              <input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} />
              Also wipe the account (temp phone-signup accounts only)
            </label>
            <button className="btn admin-danger" onClick={reset} disabled={busy}>
              Reset this number
            </button>
          </div>
        )}

        {report && (
          <div className="admin-info">
            <p className="meta">Done:</p>
            <ul>
              {report.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {err && <p className="form-err">{err}</p>}
        <button className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
