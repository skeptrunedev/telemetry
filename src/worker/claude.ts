import Anthropic from "@anthropic-ai/sdk";

// Every Claude call goes through here, tuned for speed over depth:
// - Opus 5.5 always thinks (it can't be disabled), so effort "low" keeps the
//   thinking, and the latency it adds, to a minimum.
// - Fast mode (research preview, Claude API only) serves the same model at up
//   to 2.5x the output speed for 2x the price. It has its own rate limit, so a
//   429 on a fast request falls back to standard speed instead of failing.

export const CLAUDE_MODEL = "claude-opus-5-5";
const FAST_MODE_BETA = "fast-mode-2026-02-01";

type CreateParams = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "model" | "speed" | "betas">;
type StreamParams = Omit<Anthropic.Beta.MessageStreamParams, "model" | "speed" | "betas">;

function withDefaults<P extends { output_config?: Anthropic.Beta.BetaOutputConfig | null }>(params: P) {
  return { ...params, model: CLAUDE_MODEL, output_config: { effort: "low" as const, ...params.output_config } };
}

/** One log line per call so Workers Logs shows the speed actually served. */
export function logClaudeUsage(label: string, msg: Anthropic.Beta.BetaMessage, startedAt: number) {
  const u = msg.usage;
  console.log(
    `claude ${label} speed=${u.speed ?? "standard"} in=${u.input_tokens} cached=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens} ms=${Date.now() - startedAt}`,
  );
}

/** One request at fast speed, retried at standard speed if fast mode is rate limited. */
export async function claudeCreate(apiKey: string, params: CreateParams): Promise<Anthropic.Beta.BetaMessage> {
  const client = new Anthropic({ apiKey });
  const base = withDefaults(params);
  const startedAt = Date.now();
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await client.beta.messages.create({ ...base, speed: "fast", betas: [FAST_MODE_BETA] }, { maxRetries: 0 });
  } catch (e) {
    if (!(e instanceof Anthropic.RateLimitError)) throw e;
    msg = await client.beta.messages.create(base);
  }
  logClaudeUsage("create", msg, startedAt);
  return msg;
}

/**
 * A streamed request. `fast` is false after the caller saw a fast-mode 429
 * (isFastModeRateLimit), so it can retry the turn at standard speed.
 */
export function claudeStream(apiKey: string, params: StreamParams, fast = true) {
  const client = new Anthropic({ apiKey });
  const base = withDefaults(params);
  return fast
    ? client.beta.messages.stream({ ...base, speed: "fast", betas: [FAST_MODE_BETA] }, { maxRetries: 0 })
    : client.beta.messages.stream(base);
}

export const isFastModeRateLimit = (e: unknown) => e instanceof Anthropic.RateLimitError;

/** Marks the last tool for prompt caching so the fixed tool list is reused across turns. */
export function cachedTools(tools: Anthropic.Beta.BetaTool[]): Anthropic.Beta.BetaTool[] {
  return tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t));
}
