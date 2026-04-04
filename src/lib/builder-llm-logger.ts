// src/lib/builder-llm-logger.ts
//
// Utility for logging LLM prompt/response pairs from the portfolio builder.
// Call logLlmStep() after every Anthropic API call in the builder routes.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@anthropic-ai/sdk/resources";

interface LogLlmStepParams {
  supabase:   SupabaseClient;
  run_id:     string | null;      // null = no run yet, skip logging silently
  step:       "strategy" | "themes" | "allocation";
  prompt:     string;
  message:    Message;            // raw Anthropic response
  started_at: number;             // Date.now() before the API call
}

export async function logLlmStep({
  supabase,
  run_id,
  step,
  prompt,
  message,
  started_at,
}: LogLlmStepParams): Promise<void> {
  if (!run_id) return;

  const response = message.content
    .filter(b => b.type === "text")
    .map(b => (b as { type: "text"; text: string }).text)
    .join("");

  await supabase.from("portfolio_build_llm_logs").insert({
    run_id,
    step,
    prompt,
    response,
    model:         message.model,
    input_tokens:  message.usage?.input_tokens  ?? null,
    output_tokens: message.usage?.output_tokens ?? null,
    latency_ms:    Date.now() - started_at,
  });
  // Logging failures are non-fatal — never throw
}
