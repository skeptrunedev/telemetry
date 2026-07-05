import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  AttachmentPrimitive,
  useAttachment,
  SimpleImageAttachmentAdapter,
  type ChatModelAdapter,
  type ChatModelRunResult,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { ArrowUp, Square, Camera, Check, Loader2, X } from "lucide-react";
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
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.messages.some((m) => typeof m.content === "string" && m.content.toLowerCase().includes(q)),
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

const TOOL_LABELS: Record<string, string> = {
  list_food_log: "Reading food log",
  move_meal: "Moving meal",
  move_food_item: "Moving food",
};

// Compact chip for a coach tool call — spinner while running, check when done.
function ToolFallback({ toolName, result }: { toolName: string; result?: unknown }) {
  const done = result !== undefined;
  return (
    <div className={`tool-chip ${done ? "done" : "running"}`}>
      {done ? <Check className="tool-chip-icon" /> : <Loader2 className="tool-chip-icon spin" />}
      <span>{TOOL_LABELS[toolName] ?? toolName}</span>
    </div>
  );
}

function ImagePart({ image }: { image?: string }) {
  if (!image) return null;
  return <img className="bubble-photo" src={image} alt="attached photo" />;
}

// Sent photos live on message.attachments (not content parts), so the bubble
// needs its own renderer to show them.
function SentPhoto() {
  const attachment = useAttachment();
  const image = attachment.content?.find(
    (p): p is { type: "image"; image: string } => p.type === "image",
  )?.image;
  return <ImagePart image={image} />;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="bubble bubble-user">
      <MessagePrimitive.Attachments components={{ Attachment: SentPhoto }} />
      <MessagePrimitive.Parts components={{ Image: ImagePart }} />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="bubble bubble-assistant">
      <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Fallback: ToolFallback } }} />
    </MessagePrimitive.Root>
  );
}

// ChatGPT-style pill: textarea + send/stop control share one rounded container.
function AttachmentChip() {
  return (
    <AttachmentPrimitive.Root className="attach-chip">
      <AttachmentPrimitive.unstable_Thumb className="attach-thumb" />
      <AttachmentPrimitive.Name />
      <AttachmentPrimitive.Remove className="attach-remove" aria-label="Remove photo">
        <X />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="composer">
      <div className="attach-row">
        <ComposerPrimitive.Attachments components={{ Attachment: AttachmentChip }} />
      </div>
      {/* multiple={false} keeps "Take Photo" in iOS's picker sheet — Safari
          hides the camera option for multi-select file inputs */}
      <ComposerPrimitive.AddAttachment multiple={false} className="composer-attach" aria-label="Add a photo">
        <Camera />
      </ComposerPrimitive.AddAttachment>
      <ComposerPrimitive.Input className="chat-input" placeholder="What are you thinking of eating?" autoFocus />
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send className="composer-send" aria-label="Send">
          <ArrowUp />
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel className="composer-send composer-stop" aria-label="Stop">
          <Square fill="currentColor" strokeWidth={0} />
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </ComposerPrimitive.Root>
  );
}

// Swap data-URL photos in a completed user turn for uploaded R2 URLs before
// persisting, so saved conversations stay small and the photos render again on
// reload. An upload failure keeps the data URL (the server flattens it to a
// "[photo]" marker, matching the old behavior).
async function uploadTurnPhotos(m: CoachMessage): Promise<CoachMessage> {
  if (typeof m.content === "string") return m;
  const content = await Promise.all(
    m.content.map(async (p) => {
      if (p.type !== "image" || !p.image.startsWith("data:")) return p;
      try {
        const blob = await (await fetch(p.image)).blob();
        const { url } = await api.uploadAgentPhoto(blob);
        return { type: "image" as const, image: url };
      } catch {
        return p;
      }
    }),
  );
  return { ...m, content };
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
          .map((m) => {
            const parts: ({ type: "text"; text: string } | { type: "image"; image: string })[] = [];
            const seenImages = new Set<string>();
            const pushImage = (image: string) => {
              if (seenImages.has(image)) return;
              seenImages.add(image);
              parts.push({ type: "image", image });
            };
            for (const p of m.content) {
              if (p.type === "text" && p.text.trim()) parts.push({ type: "text", text: p.text });
              else if (p.type === "image" && typeof p.image === "string") pushImage(p.image);
            }
            // attachments carry their content parts separately on some paths
            const atts = (m as { attachments?: { content?: { type?: string; image?: string }[] }[] }).attachments ?? [];
            for (const a of atts) for (const p of a.content ?? []) {
              if (p.type === "image" && typeof p.image === "string") pushImage(p.image);
            }
            const hasImage = parts.some((p) => p.type === "image");
            return {
              role: m.role as "user" | "assistant",
              content: hasImage
                ? parts
                : parts.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join("\n"),
            };
          })
          .filter((m) => (typeof m.content === "string" ? m.content.trim().length > 0 : m.content.length > 0));

        const res = await api.coachStream(history, todayLocal(), abortSignal);
        const reader = res.body?.getReader();
        if (!reader) throw new Error("coach stream unavailable");
        const decoder = new TextDecoder();

        // Parse the NDJSON event stream into ordered assistant-ui content parts:
        // text parts accumulate; each tool call becomes a "tool-call" part whose
        // result is filled in when it arrives.
        type Part =
          | { type: "text"; text: string }
          | { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown>; argsText: string; result?: unknown };
        const parts: Part[] = [];
        let cur: { type: "text"; text: string } | null = null;
        const snapshot = (): ChatModelRunResult =>
          ({ content: parts.map((p) => ({ ...p })) }) as unknown as ChatModelRunResult;
        const handle = (line: string) => {
          const s = line.trim();
          if (!s) return;
          let ev: { t: string; v?: string; id?: string; name?: string; args?: unknown; result?: unknown };
          try {
            ev = JSON.parse(s);
          } catch {
            return;
          }
          if (ev.t === "text" && ev.v) {
            if (!cur) {
              cur = { type: "text", text: "" };
              parts.push(cur);
            }
            cur.text += ev.v;
          } else if (ev.t === "tool") {
            cur = null;
            parts.push({
              type: "tool-call",
              toolCallId: String(ev.id),
              toolName: String(ev.name),
              args: (ev.args ?? {}) as Record<string, unknown>,
              argsText: JSON.stringify(ev.args ?? {}),
            });
          } else if (ev.t === "result") {
            const p = parts.find((x) => x.type === "tool-call" && x.toolCallId === String(ev.id));
            if (p && p.type === "tool-call") p.result = ev.result;
          }
        };

        // Race every read against the abort signal: iOS Safari does not reject
        // an in-flight reader.read() when the fetch is aborted, which left the
        // stop button dead and the thread stuck in "running" forever.
        const aborted = new Promise<never>((_, reject) => {
          const fail = () => reject(new DOMException("aborted", "AbortError"));
          if (abortSignal.aborted) fail();
          else abortSignal.addEventListener("abort", fail, { once: true });
        });
        aborted.catch(() => {});
        let buf = "";
        try {
          for (;;) {
            const { done, value } = await Promise.race([reader.read(), aborted]);
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              handle(buf.slice(0, nl));
              buf = buf.slice(nl + 1);
            }
            yield snapshot();
          }
        } finally {
          reader.cancel().catch(() => {});
        }
        if (buf.trim()) handle(buf);
        yield snapshot();

        const lastUser = history[history.length - 1];
        const reply = parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n")
          .trim();
        const lastUserText =
          typeof lastUser?.content === "string"
            ? lastUser.content
            : (lastUser?.content ?? [])
                .map((p) => (p.type === "text" ? p.text : "[photo]"))
                .join(" ")
                .trim();
        if (lastUser?.role === "user" && reply) {
          const turn: CoachMessage[] = [await uploadTurnPhotos(lastUser), { role: "assistant", content: reply }];
          try {
            if (!convIdRef.current) {
              const { id } = await api.createConversation(lastUserText, turn);
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
    adapters: { attachments: new SimpleImageAttachmentAdapter() },
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
