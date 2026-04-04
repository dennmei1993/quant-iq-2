// src/lib/llm-caller.ts
//
// Unified LLM caller that supports both Anthropic and OpenAI.
// Returns a normalised response so builder routes don't need to
// branch on provider — just call callLlm() and get text + usage back.

import Anthropic from "@anthropic-ai/sdk";

export type LlmProvider = "claude" | "openai";

export interface LlmResponse {
  text:          string;
  model:         string;
  input_tokens:  number | null;
  output_tokens: number | null;
  // Raw message for logging
  raw: any;
}

const anthropic = new Anthropic();

// Lazy-load OpenAI so the import doesn't fail if OPENAI_API_KEY is absent
async function getOpenAI() {
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function callLlm({
  provider  = "claude",
  model_id,
  prompt,
  max_tokens = 2000,
}: {
  provider?:  LlmProvider;
  model_id?:  string;
  prompt:     string;
  max_tokens?: number;
}): Promise<LlmResponse> {

  // ── Anthropic ──────────────────────────────────────────────────────────────
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

  // ── OpenAI ─────────────────────────────────────────────────────────────────
  if (provider === "openai") {
    const model  = model_id ?? "gpt-4o";
    const openai = await getOpenAI();
    const res    = await openai.chat.completions.create({
      model,
      max_tokens,
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
