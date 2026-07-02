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
import type { CoachMessage } from "./api";

// Bridges assistant-ui's local runtime to our grounded coach endpoint, streaming
// the reply token-by-token. We yield the full cumulative text each tick, which
// is what the runtime expects.
const coachAdapter: ChatModelAdapter = {
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
  },
};

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

// ChatGPT-style single pill: the textarea and the send/stop control live inside
// one rounded, bordered container. Send arrow when idle; stop square mid-stream.
function Composer() {
  return (
    <ComposerPrimitive.Root className="composer">
      <ComposerPrimitive.Input
        className="chat-input"
        placeholder="What are you thinking of eating?"
        autoFocus
      />
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

export function Coach() {
  const runtime = useLocalRuntime(coachAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="coach">
        <ThreadPrimitive.Viewport className="chat-list" autoScroll>
          {/* Empty thread: greeting + composer, centered (ChatGPT landing style). */}
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

          {/* Once the thread has messages, the composer docks to the bottom. */}
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
