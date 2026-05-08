// src/lib/llm-caller.ts
//
// Unified LLM caller supporting Anthropic (Claude) and OpenAI (GPT-4o, o1).
// Returns a normalised LlmResponse — builder routes call callLlm() without
// branching on provider.
//
// Provider-specific restrictions handled here:
// - o1/o1-mini: uses max_completion_tokens instead of max_tokens
// - o1/o1-mini: no system messages (not used here)
// - o1/o1-mini: no temperature (not set here)

import Anthropic from "@anthropic-ai/sdk";

export type LlmProvider = "claude" | "openai";

export interface LlmResponse {
  text:          string;
  model:         string;
  input_tokens:  number | null;
  output_tokens: number | null;
  raw:           any;
}

const anthropic = new Anthropic();

// Models that use max_completion_tokens instead of max_tokens
const OPENAI_REASONING_MODELS = new Set(["o1", "o1-mini", "o1-preview", "o3-mini"]);

// Lazy-load OpenAI so build doesn't fail if OPENAI_API_KEY is absent
async function getOpenAI() {
  const { default: OpenAI } = await import("openai");
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env.local to use OpenAI models.");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function callLlm({
  provider  = "claude",
  model_id,
  prompt,
  max_tokens = 2000,
}: {
  provider?:   LlmProvider;
  model_id?:   string;
  prompt:      string;
  max_tokens?: number;
}): Promise<LlmResponse> {

  // ── Anthropic (Claude) ────────────────────────────────────────────────────
  if (provider === "claude") {
    const model = model_id ?? "claude-sonnet-4-20250514";
    const msg   = await anthropic.messages.create({
      model,
      max_tokens,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("");
    return {
      text,
      model,
      input_tokens:  msg.usage?.input_tokens  ?? null,
      output_tokens: msg.usage?.output_tokens ?? null,
      raw: msg,
    };
  }

  // ── OpenAI ────────────────────────────────────────────────────────────────
  if (provider === "openai") {
    const model    = model_id ?? "gpt-4o";
    const openai   = await getOpenAI();
    const isReasoning = OPENAI_REASONING_MODELS.has(model);

    // o1 family uses max_completion_tokens; all others use max_tokens
    const tokenParam = isReasoning
      ? { max_completion_tokens: max_tokens }
      : { max_tokens };

    const res = await openai.chat.completions.create({
      model,
      ...tokenParam,
      messages: [{ role: "user", content: prompt }],
    });

    const text = res.choices[0]?.message?.content ?? "";
    return {
      text,
      model,
      input_tokens:  res.usage?.prompt_tokens     ?? null,
      output_tokens: res.usage?.completion_tokens ?? null,
      raw: res,
    };
  }

  throw new Error(`Unknown provider: ${provider}`);
}
