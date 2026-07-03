import { useState } from "react";
import { Check } from "lucide-react";
import { api } from "./api";
import type { Billing } from "./api";

const INCLUDED = [
  "Unlimited AI meal logging — photo, paste, or text",
  "The agent — chat, tools, saved history",
  "MCP server access from any client",
  "CLI, typed API, and scoped API keys",
  "Weight, measurements, targets & trends",
  "Smart-scale ingest webhook",
];

// Full-screen paywall shown to signed-in users without an active subscription.
export function Subscribe({ billing, email, onSignOut }: { billing: Billing; email: string; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go(fn: () => Promise<{ url: string }>) {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await fn();
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const lapsed = billing.status && billing.status !== "active" && billing.status !== "trialing";

  return (
    <div className="signin">
      <div className="signin-card">
        <p className="signin-brand">skcal</p>
        <h1 className="signin-title">{lapsed ? "Your subscription lapsed" : "One plan. Everything."}</h1>
        <p className="signin-sub">
          {lapsed
            ? "Renew to pick up right where you left off — your data is safe."
            : "skcal is $100/month — no free tier, no feature gates. Cancel anytime."}
        </p>

        <div className="sub-price">
          <span className="sub-num">$100</span>
          <span className="sub-per">/mo</span>
        </div>
        <ul className="sub-list">
          {INCLUDED.map((f) => (
            <li key={f}>
              <Check /> {f}
            </li>
          ))}
        </ul>

        <button className="btn signin-google" onClick={() => go(api.billingCheckout)} disabled={busy}>
          {busy ? "Redirecting…" : lapsed ? "Renew subscription" : "Subscribe — $100/mo"}
        </button>
        {billing.status && (
          <button className="btn ghost" onClick={() => go(api.billingPortal)} disabled={busy}>
            Manage billing
          </button>
        )}
        {err && <p className="form-err">{err}</p>}

        <p className="signin-legal">
          Signed in as {email} · <a href="#signout" onClick={(e) => { e.preventDefault(); onSignOut(); }}>Sign out</a>
          <br />
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
        </p>
      </div>
    </div>
  );
}
