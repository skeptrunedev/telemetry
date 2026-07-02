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

// ---- Shared conversation history (lives at the app level so the global nav
// drawer and the coach view both read/drive the same state) -----------------
export type CoachSession = { key: string; convId: string | null; messages: CoachMessage[] };

export function useCoachHistory() {
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  const [search, setSearch] = useState("");
  const nonceRef = useRef(0);
  const [session, setSession] = useState<CoachSession>({ key: "new-0", convId: null, messages: [] });

  const load = useCallback(async () => {
    try {
      setConversations(await api.listConversations());
    } catch {
      /* history is best-effort */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const newChat = useCallback(() => {
    nonceRef.current += 1;
    setSession({ key: `new-${nonceRef.current}`, convId: null, messages: [] });
  }, []);
  const openConversation = useCallback((conv: CoachConversation) => {
    setSession({ key: conv.id, convId: conv.id, messages: conv.messages });
  }, []);
  const onPersisted = useCallback(
    (id: string) => {
      setSession((s) => (s.convId ? s : { ...s, convId: id }));
      load();
    },
    [load],
  );
  const removeConversation = useCallback(
    async (id: string) => {
      try {
        await api.deleteConversation(id);
      } catch {
        /* ignore */
      }
      if (session.convId === id) newChat();
      else load();
    },
    [session.convId, newChat, load],
  );

  const q = search.trim().toLowerCase();
  const filtered = q
    ? conversations.filter(
        (c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)),
      )
    : conversations;

  return {
    conversations: filtered,
    activeId: session.convId,
    session,
    search,
    setSearch,
    hasQuery: !!q,
    newChat,
    openConversation,
    onPersisted,
    removeConversation,
  };
}
export type CoachHistory = ReturnType<typeof useCoachHistory>;

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

// The live coach thread. Seeded from a saved conversation (or empty for a new
// chat); streams from the coach endpoint and persists each completed turn.
// The parent applies `key={session.key}` so switching threads remounts it.
export function CoachThread({
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
              <p className="chat-welcome-title">Ask before you eat.</p>
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages>
            {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
          </ThreadPrimitive.Messages>

          <ThreadPrimitive.ViewportFooter className="chat-input-row">
            <Composer />
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
