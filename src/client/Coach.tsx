import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { api, todayLocal } from "./api";
import type { CoachMessage, CoachConversation } from "./api";

const MarkdownText = () => <MarkdownTextPrimitive />;

function UserMessage() {
  return (
    <MessagePrimitive.Root className="bubble bubble-user">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="bubble bubble-assistant">
      <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
    </MessagePrimitive.Root>
  );
}

// ChatGPT-style pill: textarea + send/stop control share one rounded container.
function Composer() {
  return (
    <ComposerPrimitive.Root className="composer">
      <ComposerPrimitive.Input className="chat-input" placeholder="What are you thinking of eating?" autoFocus />
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send className="composer-send" aria-label="Send">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 16V5M5 10l5-5 5 5" />
          </svg>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel className="composer-send composer-stop" aria-label="Stop">
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="8" height="8" rx="1.5" />
          </svg>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </ComposerPrimitive.Root>
  );
}

// One live thread. Seeded from a saved conversation's messages (or empty for a
// new chat); streams from the coach endpoint and persists each completed turn.
// Remounted (via `key`) whenever the selected conversation changes.
function ChatPane({
  initialMessages,
  initialConversationId,
  onPersisted,
}: {
  initialMessages: CoachMessage[];
  initialConversationId: string | null;
  onPersisted: (id: string) => void;
}) {
  const convIdRef = useRef<string | null>(initialConversationId);
  const onPersistedRef = useRef(onPersisted);
  onPersistedRef.current = onPersisted;

  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        const history: CoachMessage[] = messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n"),
          }))
          .filter((m) => m.content.trim());

        const res = await api.coachStream(history, todayLocal(), abortSignal);
        const reader = res.body?.getReader();
        if (!reader) throw new Error("coach stream unavailable");
        const decoder = new TextDecoder();
        let text = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          yield { content: [{ type: "text", text }] };
        }

        // Persist the completed turn (new user message + assistant reply).
        const lastUser = history[history.length - 1];
        const reply = text.trim();
        if (lastUser?.role === "user" && reply) {
          const turn: CoachMessage[] = [lastUser, { role: "assistant", content: reply }];
          try {
            if (!convIdRef.current) {
              const { id } = await api.createConversation(lastUser.content, turn);
              convIdRef.current = id;
            } else {
              await api.appendMessages(convIdRef.current, turn);
            }
            onPersistedRef.current(convIdRef.current);
          } catch {
            /* non-fatal: the reply still renders, it just isn't saved */
          }
        }
      },
    }),
    [],
  );

  const runtime = useLocalRuntime(adapter, {
    initialMessages: initialMessages.map((m) => ({ role: m.role, content: m.content })),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="coach">
        <ThreadPrimitive.Viewport className="chat-list" autoScroll>
          <ThreadPrimitive.Empty>
            <div className="chat-welcome">
              <div className="chat-empty">
                <p className="chat-empty-title">Ask before you eat.</p>
                <p className="meta">
                  I know your targets, what you've logged today, and your weight trend. Tell me what
                  you're thinking of eating and I'll give you a straight read.
                </p>
              </div>
              <Composer />
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages>
            {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
          </ThreadPrimitive.Messages>

          <ThreadPrimitive.ViewportFooter className="chat-input-row">
            <ThreadPrimitive.If empty={false}>
              <Composer />
            </ThreadPrimitive.If>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

export function Coach() {
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nonceRef = useRef(0);
  const [session, setSession] = useState<{ key: string; convId: string | null; messages: CoachMessage[] }>({
    key: "new-0",
    convId: null,
    messages: [],
  });

  const load = useCallback(async () => {
    try {
      setConversations(await api.listConversations());
    } catch {
      /* ignore — history is best-effort */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const newChat = () => {
    nonceRef.current += 1;
    setSession({ key: `new-${nonceRef.current}`, convId: null, messages: [] });
    setDrawerOpen(false);
  };
  const openConversation = (conv: CoachConversation) => {
    setSession({ key: conv.id, convId: conv.id, messages: conv.messages });
    setDrawerOpen(false);
  };
  const onPersisted = (id: string) => {
    // Highlight the freshly-saved new chat without remounting the live thread.
    setSession((s) => (s.convId ? s : { ...s, convId: id }));
    load();
  };
  const removeConversation = async (id: string) => {
    try {
      await api.deleteConversation(id);
    } catch {
      /* ignore */
    }
    if (session.convId === id) newChat();
    else load();
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)),
      )
    : conversations;
  const activeTitle = conversations.find((c) => c.id === session.convId)?.title ?? "New chat";

  return (
    <div className="coach-shell">
      {drawerOpen && <div className="coach-backdrop" onClick={() => setDrawerOpen(false)} />}

      <aside className={`coach-sidebar ${drawerOpen ? "open" : ""}`}>
        <div className="coach-sidebar-head">
          <button className="coach-newchat" onClick={newChat}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M10 4v12M4 10h12" />
            </svg>
            New chat
          </button>
          <button className="coach-icon-btn coach-close" onClick={() => setDrawerOpen(false)} aria-label="Close">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <input
          className="coach-search"
          placeholder="Search chats"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="coach-recents-label">Recents</div>
        <nav className="coach-recents">
          {filtered.length === 0 && (
            <p className="meta coach-empty-list">{q ? "No matches" : "No conversations yet"}</p>
          )}
          {filtered.map((c) => (
            <div key={c.id} className={`coach-recent ${session.convId === c.id ? "active" : ""}`}>
              <button className="coach-recent-title" onClick={() => openConversation(c)} title={c.title}>
                {c.title}
              </button>
              <button
                className="coach-icon-btn coach-recent-del"
                onClick={() => removeConversation(c.id)}
                aria-label="Delete conversation"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L15 6" />
                </svg>
              </button>
            </div>
          ))}
        </nav>
      </aside>

      <div className="coach-main">
        <div className="coach-topbar">
          <button className="coach-icon-btn" onClick={() => setDrawerOpen(true)} aria-label="Conversation history">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          </button>
          <span className="coach-topbar-title">{activeTitle}</span>
          <button className="coach-icon-btn" onClick={newChat} aria-label="New chat">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M10 4v12M4 10h12" />
            </svg>
          </button>
        </div>

        <ChatPane
          key={session.key}
          initialMessages={session.messages}
          initialConversationId={session.convId}
          onPersisted={onPersisted}
        />
      </div>
    </div>
  );
}
