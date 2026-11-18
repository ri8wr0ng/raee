/** Which model provider the assistant uses, picked from whichever API key the user saved. */
export type AssistantProvider = "anthropic" | "openai" | "openrouter";

/** Preference order when several keys are saved. */
export const providerOrder: readonly AssistantProvider[] = ["anthropic", "openai", "openrouter"];

export const providerKeyEnv: Record<AssistantProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/** Default model per provider. SIDECUT_AGENT_MODEL overrides it for the selected provider. */
export const defaultModels: Record<AssistantProvider, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-6-luna-fast",
  openrouter: "anthropic/claude-sonnet-5.5",
};

type Env = Record<string, string | undefined>;

/**
 * eve needs a context window for models outside its catalog (custom or less common OpenRouter
 * IDs). A conservative shared value works for every default and keeps compaction predictable.
 */
export const contextWindowTokens = 200_000;

export function selectProvider(env: Env): AssistantProvider | undefined {
  const forced = env.SIDECUT_AGENT_PROVIDER as AssistantProvider | undefined;
  if (forced && providerOrder.includes(forced) && env[providerKeyEnv[forced]]?.trim())
    return forced;
  return providerOrder.find((provider) => env[providerKeyEnv[provider]]?.trim());
}

export async function resolveModel(env: Env = process.env) {
  return { model: await providerModel(env), modelContextWindowTokens: contextWindowTokens };
}

async function providerModel(env: Env) {
  const provider = selectProvider(env);
  if (!provider)
    throw new Error(
      "No assistant API key is set. Add an Anthropic, OpenAI or OpenRouter key in the Assistant panel.",
    );
  const id = env.SIDECUT_AGENT_MODEL?.trim() || defaultModels[provider];
  if (provider === "anthropic") {
    const { anthropic } = await import("eve/models/anthropic");
    return anthropic(id);
  }
  if (provider === "openai") {
    const { openai } = await import("eve/models/openai");
    return openai(id);
  }
  const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
  return createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY ?? "",
    // Lets the smoke test (or an OpenRouter-compatible gateway) stand in for openrouter.ai.
    ...(env.OPENROUTER_BASE_URL ? { baseURL: env.OPENROUTER_BASE_URL } : {}),
  }).chat(id);
}
