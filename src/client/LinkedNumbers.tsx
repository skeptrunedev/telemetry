import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "./api";
import type { Channel } from "./api";

// Manage the phone numbers linked to this account. A linked, verified number
// can text the skcal iMessage agent and act on this account's data.
export function LinkedNumbers({ onClose }: { onClose: () => void }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listChannels().then(setChannels).catch(() => setChannels([]));
  }, []);
  useEffect(load, [load]);

  async function sendCode() {
    setBusy(true);
    setErr(null);
    try {
      await api.startPhoneLink(phone.trim());
      setStage("code");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setErr(null);
    try {
      await api.verifyPhoneLink(phone.trim(), code.trim());
      setPhone("");
      setCode("");
      setStage("phone");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.deleteChannel(id).catch(() => {});
    load();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet mcp-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="mcp-title">Linked numbers</h2>
        <p className="meta">
          Text the skcal agent from a linked number and it acts on your account: log meals (even by
          photo), check your day, record weigh-ins.
        </p>

        <div className="key-create">
          {stage === "phone" ? (
            <>
              <label className="field">
                <span>Phone number</span>
                <input
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 415 555 0123"
                  maxLength={20}
                />
              </label>
              {err && <p className="form-err">{err}</p>}
              <button className="btn" onClick={sendCode} disabled={busy || !phone.trim()}>
                {busy ? "Sending…" : "Text me a code"}
              </button>
            </>
          ) : (
            <>
              <label className="field">
                <span>Code sent to {phone}</span>
                <input
                  inputMode="numeric"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  maxLength={10}
                />
              </label>
              {err && <p className="form-err">{err}</p>}
              <button className="btn" onClick={verify} disabled={busy || code.trim().length < 4}>
                {busy ? "Verifying…" : "Verify & link"}
              </button>
              <button className="btn ghost" onClick={() => { setStage("phone"); setCode(""); setErr(null); }} disabled={busy}>
                Use a different number
              </button>
            </>
          )}
        </div>

        <div className="coach-recents-label">Your numbers</div>
        <div className="key-list">
          {channels == null ? (
            <p className="meta">loading…</p>
          ) : channels.length === 0 ? (
            <p className="meta">No numbers linked yet.</p>
          ) : (
            channels.map((ch) => (
              <div className="key-row" key={ch.id}>
                <div className="key-row-main">
                  <span className="key-row-name">{ch.value}</span>
                  <span className="key-row-meta">
                    {ch.kind} · {ch.verified ? "verified" : "unverified"}
                  </span>
                </div>
                <button className="nav-icon-btn" aria-label={`Unlink ${ch.value}`} onClick={() => remove(ch.id)}>
                  <Trash2 />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
