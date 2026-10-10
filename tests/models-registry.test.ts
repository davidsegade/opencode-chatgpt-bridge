import { describe, expect, it } from "vitest";
import {
  findFreeModel,
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