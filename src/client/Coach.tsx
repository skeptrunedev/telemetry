import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  AttachmentPrimitive,
  useAttachment,
  useComposerRuntime,
  SimpleImageAttachmentAdapter,
  type ChatModelAdapter,
  type ChatModelRunResult,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { ArrowUp, Square, Camera, Check, ImagePlus, Loader2, X } from "lucide-react";
import { api, todayLocal } from "./api";
import type { CoachMessage, CoachConversation } from "./api";

// ---- Shared conversation history (lives at the app level so the global nav
// drawer and the coach view both read/drive the same state) -----------------
export type CoachSession = { key: string; convId: string | null; messages: CoachMessage[] };

export function useCoachHistory() {
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  // True once the first listConversations attempt settles — deep links wait on
  // this before deciding whether the URL's conversation id exists.
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const nonceRef = useRef(0);
  const [session, setSession] = useState<CoachSession>({ key: "new-0", convId: null, messages: [] });

  const load = useCallback(async () => {
    try {
      setConversations(await api.listConversations());
    } catch {
      /* history is best-effort */
    } finally {
      setLoaded(true);
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
  // Open a conversation by id (URL deep links / Back-Forward). Looks in the
  // full (unfiltered) list; false when the id is unknown so the caller can
  // fall back to a fresh chat.
  const openById = useCallback(
    (id: string) => {
      const conv = conversations.find((x) => x.id === id);
      if (conv) openConversation(conv);
      return conv !== undefined;
    },
    [conversations, openConversation],
  );
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
    loaded,
    session,
    search,
    setSearch,
    hasQuery: !!q,
    newChat,
    openConversation,
    openById,
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

// Pending photo preview: a large rounded thumbnail with the remove control
// floating on its corner (no filename), built from the picked file directly.
function AttachmentChip() {
  const attachment = useAttachment();
  const file = (attachment as { file?: File }).file;
  const src = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);
  return (
    <AttachmentPrimitive.Root className="attach-chip">
      {src ? <img className="attach-thumb" src={src} alt="" /> : <div className="attach-thumb" />}
      <AttachmentPrimitive.Remove className="attach-remove" aria-label="Remove photo">
        <X />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

// Phone camera JPEGs routinely exceed the worker's ~8MB image cap and 400 the
// whole turn, so photos are downscaled before they enter the composer. Large
// files re-encode to JPEG capped at 1600px on the long edge; anything small,
// undecodable (e.g. HEIC), or that fails mid-resize passes through unchanged.
const PHOTO_BYTE_LIMIT = 2_500_000;
const PHOTO_MAX_EDGE = 1600;
async function downscalePhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= PHOTO_BYTE_LIMIT) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// One visible attach button that opens our own source sheet instead of the
// native picker. iOS hides "Take Photo" for multi-select file inputs, so a
// single input can't offer both the camera and library multi-select — each
// option gets its own hidden input behind the sheet.
function AttachButton() {
  const composer = useComposerRuntime();
  const [open, setOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    for (const file of Array.from(input.files ?? [])) await composer.addAttachment(await downscalePhoto(file));
    input.value = ""; // so re-picking the same file fires change again
  };

  const pick = (ref: RefObject<HTMLInputElement | null>) => {
    setOpen(false);
    ref.current?.click();
  };

  return (
    <>
      <button type="button" className="composer-attach" aria-label="Add a photo" onClick={() => setOpen(true)}>
        <Camera />
      </button>
      {/* capture opens the camera directly on phones (file dialog on desktop) */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPicked} />
      <input ref={libraryRef} type="file" accept="image/*" multiple hidden onChange={onPicked} />
      {open &&
        createPortal(
          <div className="sheet-backdrop attach-source-backdrop" onClick={() => setOpen(false)}>
            <div
              className="sheet attach-source-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Add a photo"
              onClick={(e) => e.stopPropagation()}
            >
              <button type="button" className="attach-source-option" onClick={() => pick(cameraRef)}>
                <Camera />
                Take photo
              </button>
              <button type="button" className="attach-source-option" onClick={() => pick(libraryRef)}>
                <ImagePlus />
                Photo library
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="composer">
      <div className="attach-row">
        <ComposerPrimitive.Attachments components={{ Attachment: AttachmentChip }} />
      </div>
      <AttachButton />
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

        // The worker caps history at 20 messages; send the newest window,
        // opened on a user message, so long conversations keep working.
        let window = history.slice(-20);
        while (window.length && window[0]?.role !== "user") window = window.slice(1);

        let res: Response;
        try {
          res = await api.coachStream(window, todayLocal(), abortSignal);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") throw err;
          yield {
            content: [{ type: "text", text: "That message didn't go through, give it another try in a moment." }],
          } as unknown as ChatModelRunResult;
          return;
        }
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
