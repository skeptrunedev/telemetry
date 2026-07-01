import { useEffect, useRef, useState } from "react";
import { api, todayLocal } from "./api";
import type { CoachMessage } from "./api";

export function Coach() {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: CoachMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setErr(null);
    setBusy(true);
    try {
      const { reply } = await api.coach(next, todayLocal());
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="coach">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p className="chat-empty-title">Ask before you eat.</p>
            <p className="meta">
              I know your targets, what you've logged today, and your weight trend. Tell me what you're
              thinking of eating and I'll give you a straight read.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble-${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="bubble bubble-assistant bubble-thinking">thinking…</div>}
        {err && <p className="form-err">{err}</p>}
      </div>

      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={2000}
          placeholder="e.g. what do you think of a meat pie for breakfast?"
          disabled={busy}
        />
        <button className="btn chat-send" onClick={send} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
