import { z } from "zod/v4";

export type FreeModel = {
  provider: string;
  modelId: string;
  alias: string;
  description?: string;
};

export const FREE_MODELS: FreeModel[] = [
  {
    provider: "opencode",
    modelId: "mimo-v2.6-flash-free",
    alias: "mimo-v2.6-flash-free",
    description: "Fast free model for code generation"
  },
  {
    provider: "opencode",
    modelId: "space-bunny-free",
    alias: "space-bunny-free",
    description: "Free model for code review"
  }
];

export function findFreeModel(identifier: string): FreeModel | undefined {
  const normalized = identifier.toLowerCase();
  return FREE_MODELS.find(
    (m) => m.modelId.toLowerCase() === normalized || m.alias.toLowerCase() === normalized || `${m.provider}/${m.modelId}`.toLowerCase() === normalized
  );
}

export function validateFreeModel(identifier: string): FreeModel {
  const model = findFreeModel(identifier);
  if (!model) {
    const available = FREE_MODELS.map((m) => `${m.provider}/${m.modelId} (alias: ${m.alias})`).join(", ");
    throw new Error(`Model "${identifier}" is not in the free-model registry. Available: ${available}`);
  }
  return model;
}

export function getFreeModelAliases(): string[] {
  return FREE_MODELS.map((m) => m.alias);
}

export function getFreeModelProviders(): string[] {
  return [...new Set(FREE_MODELS.map((m) => m.provider))];
}

export type QuotaErrorCode = "QUOTA_EXCEEDED" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "MODEL_NOT_FOUND";

export class QuotaError extends Error {
  public readonly code: QuotaErrorCode;
  public readonly model: FreeModel;

  constructor(message: string, code: QuotaErrorCode, model: FreeModel) {
    super(message);
    this.name = "QuotaError";
    this.code = code;
    this.model = model;
  }
}

export function detectQuotaError(error: unknown): QuotaError | undefined {
  if (!(error instanceof Error)) return undefined;
  const message = error.message.toLowerCase();
  if (message.includes("quota") || message.includes("exceeded") || message.includes("limit exceeded")) {
    return new QuotaError(error.message, "QUOTA_EXCEEDED", { provider: "", modelId: "", alias: "" });
  }
  if (message.includes("rate limit") || message.includes("rate limited") || message.includes("429")) {
    return new QuotaError(error.message, "RATE_LIMITED", { provider: "", modelId: "", alias: "" });
  }
  if (message.includes("unavailable") || message.includes("503") || message.includes("502") || message.includes("connection refused")) {
    return new QuotaError(error.message, "PROVIDER_UNAVAILABLE", { provider: "", modelId: "", alias: "" });
  }
  if (message.includes("not found") || message.includes("404") || message.includes("model not found")) {
    return new QuotaError(error.message, "MODEL_NOT_FOUND", { provider: "", modelId: "", alias: "" });
  }
  return undefined;
}

export function resolveFreeModelFallback(
  primary: FreeModel,
  exclude: Set<string> = new Set()
): FreeModel | undefined {
  const candidates = FREE_MODELS.filter(
    (m) => m.provider === primary.provider && m.modelId !== primary.modelId && !exclude.has(m.modelId)
  );
  return candidates[0];
}

export function isFreeModel(identifier: string): boolean {
  return findFreeModel(identifier) !== undefined;
}

const ProviderInventorySchema = z.object({
  connected: z.array(z.string()),
  all: z.array(z.object({ id: z.string(), models: z.record(z.string(), z.unknown()) }))
});
const ZeroCostModelSchema = z.object({
  id: z.string(),
  status: z.literal("active"),
  cost: z.object({
    input: z.literal(0), output: z.literal(0),
    cache: z.object({ read: z.literal(0), write: z.literal(0) })
  })
});

/** Validate current advertised tariffs; this is not measured execution cost. */
export function validateLiveFreeModels(inventory: unknown, required: FreeModel[]): FreeModel[] {
  const parsed = ProviderInventorySchema.safeParse(inventory);
  if (!parsed.success) throw new Error("Invalid OpenCode provider inventory; refusing unverified model costs.");
  const available = FREE_MODELS.filter(model => {
    if (!parsed.data.connected.includes(model.provider)) return false;
    const providers = parsed.data.all.filter(provider => provider.id === model.provider);
    if (providers.length !== 1) return false;
    const live = ZeroCostModelSchema.safeParse(providers[0]!.models[model.modelId]);
    return live.success && live.data.id === model.modelId;
  });
  for (const model of required) {
    if (!available.some(candidate => candidate.provider === model.provider && candidate.modelId === model.modelId)) {
      throw new Error(`Model ${model.provider}/${model.modelId} is not connected, active and verified zero-cost.`);
    }
  }
  return available;
}
