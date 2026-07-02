import { useCallback, useEffect, useState } from "react";
import { Copy, Check, Trash2 } from "lucide-react";
import { API_SCOPES } from "../shared/types";
import { api } from "./api";
import type { ApiKey } from "./api";

// Group scopes by resource for the limit-scope checkboxes.
const SCOPE_GROUPS = API_SCOPES.reduce<Record<string, string[]>>((acc, s) => {
  const resource = s.split(":")[0];
  (acc[resource] ??= []).push(s);
  return acc;
}, {});

const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function ApiKeys({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState("");
  const [limit, setLimit] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    api.listApiKeys().then(setKeys).catch(() => setKeys([]));
  }, []);
  useEffect(load, [load]);

  function toggle(scope: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(scope) ? next.delete(scope) : next.add(scope);
      return next;
    });
  }

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const scopes = limit ? [...selected] : ["*"];
      if (limit && scopes.length === 0) throw new Error("Pick at least one scope, or use full access.");
      const key = await api.createApiKey(name.trim(), scopes);
      setCreated({ name: key.name, token: key.token });
      setName("");
      setLimit(false);
      setSelected(new Set());
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.deleteApiKey(id).catch(() => {});
    load();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet mcp-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="mcp-title">API keys</h2>
        <p className="meta">
          Bearer tokens for the HTTP API — send as <code>Authorization: Bearer skcal_…</code>. Keys default to
          full access; limit the scope below.
        </p>

        {created && (
          <div className="key-created">
            <p className="key-created-title">Copy your new key now — it won't be shown again.</p>
            <div className="mcp-copy">
              <code>{created.token}</code>
              <button
                className="nav-icon-btn"
                aria-label="Copy key"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(created.token);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  } catch {
                    /* select manually */
                  }
                }}
              >
                {copied ? <Check /> : <Copy />}
              </button>
            </div>
            <button className="btn ghost sm" onClick={() => setCreated(null)}>
              Done
            </button>
          </div>
        )}

        <div className="key-create">
          <label className="field">
            <span>New key name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. laptop script" maxLength={80} />
          </label>

          <label className="key-check">
            <input type="checkbox" checked={limit} onChange={(e) => setLimit(e.target.checked)} />
            <span>Limit scope (default: full access)</span>
          </label>

          {limit && (
            <div className="key-scopes">
              {Object.entries(SCOPE_GROUPS).map(([resource, scopes]) => (
                <div className="key-scope-group" key={resource}>
                  <span className="key-scope-res">{resource}</span>
                  {scopes.map((s) => (
                    <label className="key-check" key={s}>
                      <input type="checkbox" checked={selected.has(s)} onChange={() => toggle(s)} />
                      <span>{s.split(":")[1]}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}

          {err && <p className="form-err">{err}</p>}
          <button className="btn" onClick={create} disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create key"}
          </button>
        </div>

        <div className="coach-recents-label">Your keys</div>
        <div className="key-list">
          {keys == null ? (
            <p className="meta">loading…</p>
          ) : keys.length === 0 ? (
            <p className="meta">No API keys yet.</p>
          ) : (
            keys.map((k) => (
              <div className="key-row" key={k.id}>
                <div className="key-row-main">
                  <span className="key-row-name">{k.name}</span>
                  <span className="key-row-meta">
                    <code>{k.prefix}</code> · {k.scopes.includes("*") ? "full access" : `${k.scopes.length} scopes`} ·{" "}
                    {k.lastUsedAt ? `used ${fmtDate(k.lastUsedAt)}` : "never used"}
                  </span>
                </div>
                <button className="nav-icon-btn" aria-label={`Revoke ${k.name}`} onClick={() => remove(k.id)}>
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
