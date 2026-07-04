import { useRef, useState } from "react";
import { authClient } from "./auth-client";

// Normalize a user-entered phone number to E.164; bare 10-digit numbers are
// assumed US/Canada (+1). Mirrors the server's normalizePhone.
function normalizePhone(input: string): string | null {
  const s = input.replace(/[\s().-]/g, "");
  if (s.startsWith("+")) return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// The signed-out screen: phone number in, verification code back, signed in.
export function SignIn() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [throttled, setThrottled] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const normalized = useRef<string>("");

  // Local cooldown after a rate-limit so retries don't burn more attempts.
  function startCooldown(seconds: number) {
    setCooldown(seconds);
    const t = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(t);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  const sendCode = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e164 = normalizePhone(phone);
    if (!e164) {
      setError("Enter a valid phone number (US numbers can skip the +1).");
      return;
    }
    normalized.current = e164;
    setError(null);
    setThrottled(false);
    setBusy(true);
    const { error: err } = await authClient.phoneNumber.sendOtp({ phoneNumber: e164 });
    setBusy(false);
    if (err) {
      if (err.status === 429) {
        setThrottled(true);
        setError(
          err.message ??
            "Too many codes requested for this number — wait about 10 minutes and try again.",
        );
        startCooldown(60);
      } else {
        setError(err.message ?? "Couldn't send the code. Try again.");
      }
      return;
    }
    setCode("");
    setStage("code");
  };

  const verify = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const c = code.trim();
    if (c.length < 4) return;
    setError(null);
    setBusy(true);
    const { error: err } = await authClient.phoneNumber.verify({
      phoneNumber: normalized.current,
      code: c,
    });
    setBusy(false);
    if (err) {
      setError(err.message ?? "That code didn't work. Try again.");
      return;
    }
    window.location.reload();
  };

  return (
    <div className="signin">
      <div className="signin-card">
        <p className="signin-brand">skcal</p>
        <h1 className="signin-title">Sign in</h1>
        <p className="signin-sub">
          {stage === "phone"
            ? "Enter your phone number and we'll text you a sign-in code."
            : `We texted a code to ${normalized.current}.`}
        </p>

        {stage === "phone" ? (
          <form className="signin-form" onSubmit={sendCode}>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(415) 555-0132"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
              aria-label="Phone number"
              autoFocus
              required
            />
            <button className="btn" type="submit" disabled={busy || cooldown > 0 || !phone.trim()}>
              {busy ? "Sending…" : cooldown > 0 ? `Wait ${cooldown}s` : "Text me a code"}
            </button>
          </form>
        ) : (
          <>
            <form className="signin-form" onSubmit={verify}>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
                aria-label="Verification code"
                autoFocus
                required
              />
              <button className="btn" type="submit" disabled={busy || code.trim().length < 4}>
                {busy ? "Checking…" : "Sign in"}
              </button>
            </form>
            <button
              className="btn ghost"
              onClick={() => {
                setStage("phone");
                setError(null);
              }}
              disabled={busy}
            >
              Use a different number
            </button>
          </>
        )}

        {error && <p className={throttled ? "form-warn" : "form-err"}>{error}</p>}
        <p className="signin-legal">
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
        </p>
      </div>
    </div>
  );
}
