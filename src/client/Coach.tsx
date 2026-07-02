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

export function Coach() {
  const runtime = useLocalRuntime(coachAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="coach">
        <ThreadPrimitive.Viewport className="chat-list" autoScroll>
          <ThreadPrimitive.Empty>
            <div className="chat-empty">
              <p className="chat-empty-title">Ask before you eat.</p>
              <p className="meta">
                I know your targets, what you've logged today, and your weight trend. Tell me what
                you're thinking of eating and I'll give you a straight read.
              </p>
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages>
            {({ message }) => (message.role === "user" ? <UserMessage /> : <AssistantMessage />)}
          </ThreadPrimitive.Messages>

          <ThreadPrimitive.ViewportFooter className="chat-input-row">
            <ComposerPrimitive.Root className="composer">
              <ComposerPrimitive.Input
                className="chat-input"
                placeholder="What are you thinking of eating?"
                autoFocus
              />
              <ComposerPrimitive.Send className="btn chat-send">Send</ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
