import { useState } from "react";
import { signIn } from "./auth-client";

// The signed-out screen. Two ways in: Google (OAuth redirect) or an email magic
// link (passwordless). Styled to the Graphite & Amber theme — one amber accent,
// flat dark surfaces, no green.
export function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<"google" | "magic" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    setError(null);
    setBusy("google");
    try {
      // Redirects to Google; on success Better Auth returns to callbackURL.
      await signIn.social({ provider: "google", callbackURL: window.location.origin });
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  };

  const magic = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setError(null);
    setBusy("magic");
    const { error: err } = await signIn.magicLink({ email: addr, callbackURL: window.location.origin });
    setBusy(null);
    if (err) {
      setError(err.message ?? "Couldn't send the link. Try again.");
      return;
    }
    setSent(true);
  };

  return (
    <div className="signin">
      <div className="signin-card">
        <p className="signin-brand">skcal</p>
        <h1 className="signin-title">Sign in</h1>
        <p className="signin-sub">Body-recomposition tracking. One account, your data only.</p>

        {sent ? (
          <div className="signin-sent">
            <p className="signin-sent-title">Check your inbox</p>
            <p className="signin-sub">
              We sent a sign-in link to <span className="signin-email">{email.trim()}</span>. It expires shortly
              and can only be used once.
            </p>
            <button className="btn ghost" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <button className="btn signin-google" onClick={google} disabled={busy != null}>
              {busy === "google" ? "Redirecting…" : "Continue with Google"}
            </button>

            <div className="signin-or">
              <span>or</span>
            </div>

            <form className="signin-form" onSubmit={magic}>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy != null}
                aria-label="Email address"
                required
              />
              <button className="btn" type="submit" disabled={busy != null || !email.trim()}>
                {busy === "magic" ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          </>
        )}

        {error && <p className="form-err">{error}</p>}
        <p className="signin-legal">
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
        </p>
      </div>
    </div>
  );
}
