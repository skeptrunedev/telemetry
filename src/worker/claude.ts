import Anthropic from "@anthropic-ai/sdk";

// Every Claude call goes through here, tuned for speed over depth:
// - Opus 5.5 always thinks (it can't be disabled), so effort "low" keeps the
//   thinking, and the latency it adds, to a minimum.
// - Fast mode (research preview, Claude API only) serves the same model at up
//   to 2.5x the output speed for 2x the price. It needs the organization to be
//   enrolled (an unenrolled org has a fast-mode limit of 0 tokens/min), so it is
//   off unless the Worker var CLAUDE_FAST_MODE is "1". It has its own rate
//   limit, so a 429 on a fast request falls back to standard speed.

export const CLAUDE_MODEL = "claude-opus-5-5";
const FAST_MODE_BETA = "fast-mode-2026-02-01";

/** The Worker bindings these helpers read. */
export interface ClaudeEnv {
  ANTHROPIC_API_KEY?: string;
  CLAUDE_FAST_MODE?: string;
}

const fastModeOn = (env: ClaudeEnv) => env.CLAUDE_FAST_MODE === "1";

type CreateParams = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "model" | "speed" | "betas">;
type StreamParams = CreateParams;

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
export async function claudeCreate(env: ClaudeEnv, params: CreateParams): Promise<Anthropic.Beta.BetaMessage> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const base = withDefaults(params);
  const startedAt = Date.now();
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = fastModeOn(env)
      ? await client.beta.messages.create({ ...base, speed: "fast", betas: [FAST_MODE_BETA] }, { maxRetries: 0 })
      : await client.beta.messages.create(base);
  } catch (e) {
    if (!(e instanceof Anthropic.RateLimitError)) throw e;
    console.log(`claude fast mode rate limited, retrying at standard speed: ${e.message.slice(0, 300)}`);
    msg = await client.beta.messages.create(base);
  }
  logClaudeUsage("create", msg, startedAt);
  return msg;
}

/**
 * A streamed request. Pass `fast` false after a fast-mode 429
 * (isFastModeRateLimit) to retry the turn at standard speed.
 */
export function claudeStream(env: ClaudeEnv, params: StreamParams, fast = true) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const base = withDefaults(params);
  return fast && fastModeOn(env)
    ? client.beta.messages.stream({ ...base, speed: "fast", betas: [FAST_MODE_BETA] }, { maxRetries: 0 })
    : client.beta.messages.stream(base);
}

export function isFastModeRateLimit(e: unknown): boolean {
  if (!(e instanceof Anthropic.RateLimitError)) return false;
  console.log(`claude fast mode rate limited, retrying at standard speed: ${e.message.slice(0, 300)}`);
  return true;
}

/** Marks the last tool for prompt caching so the fixed tool list is reused across turns. */
export function cachedTools(tools: Anthropic.Beta.BetaTool[]): Anthropic.Beta.BetaTool[] {
  return tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t));
}
