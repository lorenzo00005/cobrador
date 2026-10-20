import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

// Modelo local en la PC vía Ollama (gratis, sin API keys). Desde Docker, Ollama está en host.docker.internal.
const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://host.docker.internal:11434/v1",
  includeUsage: true,
});

export default defineAgent({
  model: ollama("qwen3:8b"),
  modelContextWindowTokens: 16_000, // igual a OLLAMA_CONTEXT_LENGTH del servidor
});
