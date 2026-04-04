// src/lib/builder-llm-logger.ts
//
// Logs LLM prompt/response pairs from the portfolio builder.
// Works with both Anthropic and OpenAI responses via LlmResponse.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmResponse } from "./llm-caller";

interface LogLlmStepParams {
  supabase:   SupabaseClient;
  run_id:     string | null;
  step:       "strategy" | "themes" | "allocation";
  prompt:     string;
  response:   LlmResponse;
  started_at: number;
}

export async function logLlmStep({
  supabase,
  run_id,
  step,
  prompt,
  response,
  started_at,
}: LogLlmStepParams): Promise<void> {
  if (!run_id) return;

  try {
    await supabase.from("portfolio_build_llm_logs").insert({
      run_id,
      step,
      prompt,
      response:      response.text,
      model:         response.model,
      input_tokens:  response.input_tokens,
      output_tokens: response.output_tokens,
      latency_ms:    Date.now() - started_at,
    });
  } catch {
    // Non-fatal — logging failure never breaks the builder
  }
}
