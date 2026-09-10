/**
 * BL-FB-X-PWIN-MODEL — tests for the pure scorer.
 *
 * Pins: prior blending, set-aside eligibility mapping, factor direction
 * and caps, confidence levels, Brier scoring, and that the calibration
 * fit only runs with enough data and actually lowers log loss.
 */

import { describe, expect, it } from "vitest";
import {
  brierScore,
  CALIBRATION_MIN_N,
  computePrior,
  DEFAULT_BASE_RATE,
  fitCalibrationShift,
  logit,
  scoreFeatures,
  setAsideEligibility,
  sigmoid,
  type PwinFeatures,
  type SocioEconomic,
} from "@/lib/pwin-model";

const neutral: PwinFeatures = {
  evaluation: null,
  weAreIncumbent: false,
  competitorIncumbent: false,
  incumbentNamed: false,
  competitorCount: 0,
  setAsideEligible: null,
  naicsInOrgList: null,
  agencyHistory: null,
  naicsHistory: null,
  readiness: null,
};

const allCerts: SocioEconomic = {
  sba8a: true,
  smallBusiness: true,
  sdb: true,
  wosb: true,
  sdvosb: true,
  hubzone: true,
};
const noCerts: SocioEconomic = {
  sba8a: false,
  smallBusiness: false,
  sdb: false,
  wosb: false,
  sdvosb: false,
  hubzone: false,
};

describe("PWin — prior", () => {
  it("uses the default with no history and blends toward observed as n grows", () => {
    expect(computePrior(0, 0).baseRate).toBeCloseTo(DEFAULT_BASE_RATE, 5);
    const five = computePrior(5, 0);
    expect(five.baseRate).toBeGreaterThan(DEFAULT_BASE_RATE);
    expect(five.baseRate).toBeLessThan(1);
    const many = computePrior(90, 10);
    expect(many.baseRate).toBeGreaterThan(0.8);
    expect(many.baseRate).toBeLessThanOrEqual(0.95);
    expect(computePrior(0, 50).baseRate).toBeGreaterThanOrEqual(0.05);
  });
});

describe("PWin — set-aside eligibility", () => {
  it("returns null for no set-aside, unrestricted, unknown wording, or no profile", () => {
    expect(setAsideEligibility("", allCerts)).toBeNull();
    expect(setAsideEligibility("Full and Open", allCerts)).toBeNull();
    expect(setAsideEligibility("Tribal", allCerts)).toBeNull();
    expect(setAsideEligibility("8(a)", null)).toBeNull();
  });

  it("maps common wordings to the matching certification", () => {
    expect(setAsideEligibility("8(a) Sole Source", allCerts)).toBe(true);
    expect(setAsideEligibility("8(a)", noCerts)).toBe(false);
    expect(setAsideEligibility("SDVOSB", { ...noCerts, sdvosb: true })).toBe(true);
    expect(setAsideEligibility("Service-Disabled Veteran-Owned", noCerts)).toBe(false);
    expect(setAsideEligibility("WOSB", { ...noCerts, wosb: true })).toBe(true);
    expect(setAsideEligibility("HUBZone", { ...noCerts, hubzone: true })).toBe(true);
    // Any small-business status satisfies a total small business set-aside.
    expect(setAsideEligibility("Total Small Business", { ...noCerts, hubzone: true })).toBe(true);
    expect(setAsideEligibility("Small Business", noCerts)).toBe(false);
  });
});

describe("PWin — scoring", () => {
  const prior = computePrior(0, 0);

  it("neutral features return the prior with no factors and low confidence", () => {
    const s = scoreFeatures(neutral, prior);
    expect(s.factors).toEqual([]);
    expect(s.probability).toBeCloseTo(DEFAULT_BASE_RATE, 2);
    expect(s.pwin).toBe(30);
    expect(s.confidence).toBe("low");
    expect(s.logit).toBeCloseTo(logit(DEFAULT_BASE_RATE), 6);
  });

  it("evaluation scores move the estimate in the assessor's direction", () => {
    const strong = scoreFeatures(
      {
        ...neutral,
        evaluation: {
          strategicFit: 90,
          customerRelationship: 90,
          competitivePosture: 85,
          resourceAvailability: 80,
          financialAttractiveness: 70,
        },
      },
      prior,
    );
    const weak = scoreFeatures(
      {
        ...neutral,
        evaluation: {
          strategicFit: 20,
          customerRelationship: 10,
          competitivePosture: 15,
          resourceAvailability: 30,
          financialAttractiveness: 40,
        },
      },
      prior,
    );
    expect(strong.probability).toBeGreaterThan(0.6);
    expect(weak.probability).toBeLessThan(0.15);
    expect(strong.confidence).toBe("medium");
    // Neutral 50s add no factor.
    const flat = scoreFeatures(
      {
        ...neutral,
        evaluation: {
          strategicFit: 50,
          customerRelationship: 50,
          competitivePosture: 50,
          resourceAvailability: 50,
          financialAttractiveness: 50,
        },
      },
      prior,
    );
    expect(flat.factors).toEqual([]);
  });

  it("incumbency picks exactly one factor and set-aside ineligibility dominates", () => {
    const us = scoreFeatures({ ...neutral, weAreIncumbent: true, incumbentNamed: true }, prior);
    expect(us.factors.map((f) => f.key)).toEqual(["incumbent_us"]);
    const them = scoreFeatures({ ...neutral, competitorIncumbent: true, incumbentNamed: true }, prior);
    expect(them.factors.map((f) => f.key)).toEqual(["incumbent_competitor"]);
    const named = scoreFeatures({ ...neutral, incumbentNamed: true }, prior);
    expect(named.factors.map((f) => f.key)).toEqual(["incumbent_named"]);

    const ineligible = scoreFeatures({ ...neutral, setAsideEligible: false }, prior);
    expect(ineligible.probability).toBeLessThan(0.08);
    expect(ineligible.factors[0]!.logOdds).toBe(-2);
  });

  it("crowded field and history contributions are capped", () => {
    const crowded = scoreFeatures({ ...neutral, competitorCount: 20 }, prior);
    expect(crowded.factors[0]!.logOdds).toBe(-0.6);

    const hot = scoreFeatures({ ...neutral, agencyHistory: { won: 10, lost: 0 } }, prior);
    expect(hot.factors[0]!.logOdds).toBe(0.8);
    const cold = scoreFeatures({ ...neutral, naicsHistory: { won: 0, lost: 10 } }, prior);
    expect(cold.factors[0]!.logOdds).toBe(-0.6);
    // Too little history is ignored.
    expect(scoreFeatures({ ...neutral, agencyHistory: { won: 2, lost: 0 } }, prior).factors).toEqual([]);
  });

  it("readiness only counts compliance with enough items", () => {
    const thin = scoreFeatures(
      { ...neutral, readiness: { scanScore: null, complianceRatio: 1, complianceTotal: 3 } },
      prior,
    );
    expect(thin.factors).toEqual([]);
    const full = scoreFeatures(
      { ...neutral, readiness: { scanScore: "strong", complianceRatio: 0.9, complianceTotal: 12 } },
      prior,
    );
    expect(full.factors.map((f) => f.key).sort()).toEqual(["compliance", "scan_strong"]);
  });

  it("confidence is high only with evaluation, history and a calibratable prior", () => {
    const bigPrior = computePrior(8, 6);
    const s = scoreFeatures(
      {
        ...neutral,
        evaluation: {
          strategicFit: 60,
          customerRelationship: 60,
          competitivePosture: 60,
          resourceAvailability: 60,
          financialAttractiveness: 60,
        },
        agencyHistory: { won: 3, lost: 1 },
      },
      bigPrior,
    );
    expect(bigPrior.n).toBeGreaterThanOrEqual(CALIBRATION_MIN_N);
    expect(s.confidence).toBe("high");
  });

  it("calibration shift moves the logit directly", () => {
    const base = scoreFeatures(neutral, prior, 0);
    const shifted = scoreFeatures(neutral, prior, 1);
    expect(shifted.logit - base.logit).toBeCloseTo(1, 6);
    expect(shifted.probability).toBeCloseTo(sigmoid(base.logit + 1), 6);
  });
});

describe("PWin — grading + calibration", () => {
  it("brier: perfect is 0, coin flip is 0.25, empty is null", () => {
    expect(brierScore([])).toBeNull();
    expect(brierScore([{ p: 1, won: true }, { p: 0, won: false }])).toBe(0);
    expect(brierScore([{ p: 0.5, won: true }, { p: 0.5, won: false }])).toBe(0.25);
  });

  it("fit returns null below the minimum and otherwise lowers log loss", () => {
    const few = Array.from({ length: CALIBRATION_MIN_N - 1 }, () => ({ logit: 0, won: true }));
    expect(fitCalibrationShift(few)).toBeNull();

    // Model says 30% everywhere but the org actually wins 70% → shift up.
    const samples = Array.from({ length: 20 }, (_, i) => ({
      logit: logit(0.3),
      won: i < 14,
    }));
    const fit = fitCalibrationShift(samples);
    expect(fit).not.toBeNull();
    expect(fit!.n).toBe(20);
    expect(fit!.shift).toBeGreaterThan(1);
    expect(fit!.logLoss).toBeLessThan(fit!.logLossUnshifted);
    expect(sigmoid(logit(0.3) + fit!.shift)).toBeCloseTo(0.7, 1);
  });
});
