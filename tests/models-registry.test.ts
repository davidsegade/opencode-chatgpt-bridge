import { describe, expect, it } from "vitest";
import {
  findFreeModel,
  validateLiveFreeModels,
  validateObservedFreeUsage,
  validateFreeModel,
  getFreeModelAliases,
  detectQuotaError,
  resolveFreeModelFallback,
  isFreeModel,
  type FreeModel,
  type QuotaError
} from "../src/models/registry.js";

describe("Free Model Registry", () => {
  it("finds model by alias", () => {
    const model = findFreeModel("mimo-v2.6-flash-free");
    expect(model).toBeDefined();
    expect(model?.modelId).toBe("mimo-v2.6-flash-free");
    expect(model?.provider).toBe("opencode");
  });

  it("finds model by provider/modelId format", () => {
    const model = findFreeModel("opencode/space-bunny-free");
    expect(model).toBeDefined();
    expect(model?.modelId).toBe("space-bunny-free");
  });

  it("returns undefined for unknown model", () => {
    expect(findFreeModel("gpt-4")).toBeUndefined();
    expect(findFreeModel("claude-3-opus")).toBeUndefined();
  });

  it("validates known free model", () => {
    const model = validateFreeModel("mimo-v2.6-flash-free");
    expect(model.modelId).toBe("mimo-v2.6-flash-free");
  });

  it("throws on non-free model", () => {
    expect(() => validateFreeModel("gpt-4")).toThrow(/not in the free-model registry/);
    expect(() => validateFreeModel("claude-3-opus")).toThrow(/not in the free-model registry/);
  });

  it("returns list of aliases", () => {
    const aliases = getFreeModelAliases();
    expect(aliases).toContain("mimo-v2.6-flash-free");
    expect(aliases).toContain("space-bunny-free");
    expect(aliases.length).toBeGreaterThanOrEqual(2);
  });

  it("detects quota exceeded error", () => {
    const error = new Error("Quota exceeded for model");
    const detected = detectQuotaError(error);
    expect(detected).toBeDefined();
    expect(detected?.code).toBe("QUOTA_EXCEEDED");
  });

  it("detects rate limited error", () => {
    const error = new Error("Rate limited: 429 Too Many Requests");
    const detected = detectQuotaError(error);
    expect(detected).toBeDefined();
    expect(detected?.code).toBe("RATE_LIMITED");
  });

  it("detects provider unavailable error", () => {
    const error = new Error("Provider unavailable: 503 Service Unavailable");
    const detected = detectQuotaError(error);
    expect(detected).toBeDefined();
    expect(detected?.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("detects model not found error", () => {
    const error = new Error("Model not found: 404");
    const detected = detectQuotaError(error);
    expect(detected).toBeDefined();
    expect(detected?.code).toBe("MODEL_NOT_FOUND");
  });

  it("returns undefined for unrelated error", () => {
    const error = new Error("Network timeout");
    expect(detectQuotaError(error)).toBeUndefined();
  });

  it("resolves fallback from same provider excluding tried", () => {
    const primary: FreeModel = { provider: "opencode", modelId: "mimo-v2.6-flash-free", alias: "mimo-v2.6-flash-free" };
    const fallback = resolveFreeModelFallback(primary, new Set(["mimo-v2.6-flash-free"]));
    expect(fallback).toBeDefined();
    expect(fallback?.modelId).toBe("space-bunny-free");
    expect(fallback?.provider).toBe("opencode");
  });

  it("returns undefined when no fallback available", () => {
    const primary: FreeModel = { provider: "opencode", modelId: "mimo-v2.6-flash-free", alias: "mimo-v2.6-flash-free" };
    const fallback = resolveFreeModelFallback(primary, new Set(["mimo-v2.6-flash-free", "space-bunny-free"]));
    expect(fallback).toBeUndefined();
  });

  it("isFreeModel returns true for registered models", () => {
    expect(isFreeModel("mimo-v2.6-flash-free")).toBe(true);
    expect(isFreeModel("space-bunny-free")).toBe(true);
    expect(isFreeModel("gpt-4")).toBe(false);
  });
});

describe("live free-only inventory (real OpenCode 1.18.35 /provider shape)", () => {
  const primary = validateFreeModel("mimo-v2.6-flash-free");
  // Shape taken from @opencode-ai/sdk 1.18.35 generated types:
  // cost.cache_read / cost.cache_write are FLAT and OPTIONAL; status is OPTIONAL.
  function modelRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: primary.modelId,
      name: "MiMo",
      release_date: "2026-01-01",
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      limit: { context: 200000, output: 8192 },
      options: {},
      ...overrides
    };
  }
  function inventory() {
    return {
      connected: ["opencode"],
      all: [
        { id: "opencode", name: "opencode", env: [], api: undefined, models: { [primary.modelId]: modelRecord() } }
      ],
      default: { [primary.modelId]: primary.modelId }
    };
  }
  it("accepts a connected model whose advertised tariffs are all zero", () => {
    expect(validateLiveFreeModels(inventory(), [primary])).toEqual([primary]);
  });
  it("accepts a model that omits the optional cache tariffs", () => {
    const data = inventory();
    (data.all[0]!.models[primary.modelId]!.cost as Record<string, unknown>) = { input: 0, output: 0 };
    expect(validateLiveFreeModels(data, [primary])).toEqual([primary]);
  });
  it("accepts a model with no status field at all", () => {
    const data = inventory();
    Reflect.deleteProperty(data.all[0]!.models[primary.modelId]!, "status");
    expect(validateLiveFreeModels(data, [primary])).toEqual([primary]);
  });
  it.each([null, [], {}, { all: [], connected: [] }])("fails closed on missing inventory: %j", data => {
    expect(() => validateLiveFreeModels(data, [primary])).toThrow();
  });
  it.each(["input", "output", "cache_read", "cache_write"])("rejects a nonzero %s tariff", tariff => {
    const data = inventory();
    (data.all[0]!.models[primary.modelId]!.cost as Record<string, unknown>)[tariff] = 0.01;
    expect(() => validateLiveFreeModels(data, [primary])).toThrow(/verified zero-cost/);
  });
  it("rejects a nonzero context_over_200k tier", () => {
    const data = inventory();
    (data.all[0]!.models[primary.modelId]!.cost as Record<string, unknown>).context_over_200k = { input: 0.5, output: 0 };
    expect(() => validateLiveFreeModels(data, [primary])).toThrow(/verified zero-cost/);
  });
  it("rejects a model with no advertised cost block", () => {
    const data = inventory();
    Reflect.deleteProperty(data.all[0]!.models[primary.modelId]!, "cost");
    expect(() => validateLiveFreeModels(data, [primary])).toThrow(/verified zero-cost/);
  });
  it("rejects disconnected providers", () => {
    const data = inventory();
    data.connected = [];
    expect(() => validateLiveFreeModels(data, [primary])).toThrow(/verified zero-cost/);
  });
  it("rejects deprecated models", () => {
    const data = inventory();
    (data.all[0]!.models[primary.modelId] as Record<string, unknown>).status = "deprecated";
    expect(() => validateLiveFreeModels(data, [primary])).toThrow(/verified zero-cost/);
  });
  it("rejects ambiguous provider records", () => {
    const data = inventory();
    data.all.push(data.all[0]!);
    expect(() => validateLiveFreeModels(data, [primary])).toThrow(/verified zero-cost/);
  });
  it("rejects a model record whose id does not match its key", () => {
    const data = inventory();
    (data.all[0]!.models[primary.modelId] as Record<string, unknown>).id = "something-else";
    expect(() => validateLiveFreeModels(data, [primary])).toThrow(/verified zero-cost/);
  });
  it("requires the independent reviewer to be available too", () => {
    expect(() => validateLiveFreeModels(inventory(), [primary, validateFreeModel("space-bunny-free")])).toThrow(/verified zero-cost/);
  });
});

describe("observed zero-cost execution (real AssistantMessage shape)", () => {
  function assistant(overrides: Record<string, unknown> = {}) {
    return {
      info: {
        id: "msg_1",
        sessionID: "ses_1",
        role: "assistant",
        time: { created: 1, completed: 2 },
        parentID: "pr_1",
        modelID: "mimo-v2.6-flash-free",
        providerID: "opencode",
        mode: "build",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
        ...overrides
      },
      parts: [{ type: "text", text: "done" }]
    };
  }
  it("accepts a zero-cost turn on a registered model", () => {
    expect(validateObservedFreeUsage([assistant()])).toEqual({
      assistantMessages: 1,
      observedCost: 0,
      models: ["opencode/mimo-v2.6-flash-free"]
    });
  });
  it("ignores user messages", () => {
    const user = assistant({ role: "user" });
    expect(validateObservedFreeUsage([user]).assistantMessages).toBe(0);
  });
  it("rejects a turn that actually used a paid model", () => {
    expect(() => validateObservedFreeUsage([assistant({ providerID: "anthropic", modelID: "claude-3-opus" })])).toThrow(
      /non-registered model/
    );
  });
  it("rejects a turn that reported a nonzero cost", () => {
    expect(() => validateObservedFreeUsage([assistant({ cost: 0.01 })])).toThrow(/above the free-only budget/);
  });
  it("fails closed when metadata is missing", () => {
    const partial = assistant();
    Reflect.deleteProperty(partial.info, "cost");
    expect(() => validateObservedFreeUsage([partial])).toThrow(/cannot verify zero-cost execution/);
  });
  it("fails closed on a non-array payload", () => {
    expect(() => validateObservedFreeUsage({})).toThrow(/cannot verify observed model cost/);
  });
});
