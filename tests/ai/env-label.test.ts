/**
 * BL-ENV-SEP — one resolver for "which environment is this", shared by
 * the boot-time marker check and the non-prod banner.
 */

import { describe, expect, it } from "vitest";
import {
  envDisplayLabel,
  isKnownEnvLabel,
  isProductionEnv,
  KNOWN_ENV_LABELS,
  resolveEnvLabel,
} from "@/lib/env-label";

describe("env-label", () => {
  it("recognises Vercel's labels and the hand-set staging label", () => {
    expect(resolveEnvLabel({ VERCEL_ENV: "production" })).toBe("production");
    expect(resolveEnvLabel({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(resolveEnvLabel({ VERCEL_ENV: "development" })).toBe("development");
    // The staging Vercel project sets this by hand; the old marker check
    // did not recognise it and skipped the very environment it guards.
    expect(resolveEnvLabel({ VERCEL_ENV: "staging" })).toBe("staging");
    expect(resolveEnvLabel({ VERCEL_ENV: " Production " })).toBe("production");
  });

  it("returns null when nothing recognisable is set", () => {
    expect(resolveEnvLabel({})).toBeNull();
    expect(resolveEnvLabel({ VERCEL_ENV: "" })).toBeNull();
    expect(resolveEnvLabel({ VERCEL_ENV: "qa" })).toBeNull();
  });

  it("lets an explicit operator override win, lower-cased", () => {
    expect(resolveEnvLabel({ FORGE_ENV_OVERRIDE: "Staging", VERCEL_ENV: "production" })).toBe("staging");
    expect(resolveEnvLabel({ FORGE_ENV_OVERRIDE: "qa-lab" })).toBe("qa-lab");
  });

  it("isProductionEnv is true only for production", () => {
    expect(isProductionEnv({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionEnv({ FORGE_ENV_OVERRIDE: "production" })).toBe(true);
    expect(isProductionEnv({ FORGE_ENV_OVERRIDE: "staging", VERCEL_ENV: "production" })).toBe(false);
    expect(isProductionEnv({})).toBe(false);
  });

  it("known labels and display labels", () => {
    expect([...KNOWN_ENV_LABELS]).toEqual(["production", "staging", "preview", "development"]);
    expect(isKnownEnvLabel("staging")).toBe(true);
    expect(isKnownEnvLabel("qa")).toBe(false);
    expect(envDisplayLabel("development")).toBe("DEV");
    expect(envDisplayLabel("staging")).toBe("STAGING");
  });
});
