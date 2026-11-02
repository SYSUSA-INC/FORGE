import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkDomainDeliverability, clearDeliverabilityCache, DELIVERABILITY_CACHE_MS, resolveDomainDeliverability, type DnsResolver } from "@/lib/email-deliverability";

/** BL-STAB-8b-2 — the deliverability rule, with DNS stubbed. */
function err(code: string) {
  return Object.assign(new Error(code), { code });
}
function resolver(over: Partial<DnsResolver>): DnsResolver {
  return {
    resolveMx: vi.fn(async () => { throw err("ENOTFOUND"); }),
    resolve4: vi.fn(async () => { throw err("ENOTFOUND"); }),
    resolve6: vi.fn(async () => { throw err("ENOTFOUND"); }),
    ...over,
  };
}
/** A resolver where only the canary exists (and whatever `over` adds). */
function canaryAware(over: Partial<DnsResolver> = {}): DnsResolver {
  const base = resolver(over);
  return {
    resolveMx: async (d) => (d === "sysgov.com" ? [{ exchange: "mx.sysgov.com", priority: 10 }] : base.resolveMx(d)),
    resolve4: base.resolve4,
    resolve6: base.resolve6,
  };
}

describe("resolveDomainDeliverability", () => {
  it("MX records mean deliverable; a null MX means the domain takes no mail", async () => {
    expect((await resolveDomainDeliverability("a.test", resolver({ resolveMx: async () => [{ exchange: "mx.a.test", priority: 10 }] }))).verdict).toBe("deliverable");
    expect((await resolveDomainDeliverability("a.test", resolver({ resolveMx: async () => [{ exchange: ".", priority: 0 }] }))).verdict).toBe("undeliverable");
  });

  it("falls back to an A or AAAA record when there is no MX", async () => {
    expect((await resolveDomainDeliverability("a.test", resolver({ resolve4: async () => ["203.0.113.1"] }))).verdict).toBe("deliverable");
    expect((await resolveDomainDeliverability("a.test", resolver({ resolve6: async () => ["2001:db8::1"] }))).verdict).toBe("deliverable");
    expect((await resolveDomainDeliverability("a.test", resolver({}))).verdict).toBe("undeliverable");
  });

  it("DNS trouble is unknown, never a refusal: SERVFAIL, a timeout", async () => {
    expect((await resolveDomainDeliverability("a.test", resolver({ resolveMx: async () => { throw err("ESERVFAIL"); } }))).verdict).toBe("unknown");
    const slow = resolver({ resolveMx: () => new Promise(() => {}) });
    expect((await resolveDomainDeliverability("a.test", slow, 20)).verdict).toBe("unknown");
    // MX negative but the address lookup fails: still unknown.
    expect((await resolveDomainDeliverability("a.test", resolver({ resolve4: async () => { throw err("ETIMEOUT"); } }))).verdict).toBe("unknown");
  });
});

describe("checkDomainDeliverability", () => {
  beforeEach(() => clearDeliverabilityCache());

  it("refuses a malformed domain outright and normalises case and a trailing dot", async () => {
    expect((await checkDomainDeliverability("", { resolver: canaryAware() })).verdict).toBe("undeliverable");
    expect((await checkDomainDeliverability("nodots", { resolver: canaryAware() })).verdict).toBe("undeliverable");
    const r = canaryAware({ resolveMx: async (d) => (d === "ok.test" ? [{ exchange: "mx", priority: 1 }] : [{ exchange: "mx.sysgov.com", priority: 10 }]) });
    expect((await checkDomainDeliverability("OK.test.", { resolver: r })).verdict).toBe("deliverable");
  });

  it("an undeliverable verdict needs the canary to resolve; a dead resolver lets the address through", async () => {
    expect((await checkDomainDeliverability("dead.test", { resolver: canaryAware() })).verdict).toBe("undeliverable");
    // Nothing resolves, not even the canary: the network is the problem.
    expect((await checkDomainDeliverability("dead2.test", { resolver: resolver({}) })).verdict).toBe("unknown");
  });

  it("caches a verdict for an hour and never caches unknown", async () => {
    let t = 1_000_000;
    const now = () => t;
    const mx = vi.fn(async (d: string) => (d === "sysgov.com" ? [{ exchange: "mx.sysgov.com", priority: 10 }] : [{ exchange: "mx.c.test", priority: 1 }]));
    const r = resolver({ resolveMx: mx });
    await checkDomainDeliverability("c.test", { resolver: r, now });
    await checkDomainDeliverability("c.test", { resolver: r, now });
    expect(mx).toHaveBeenCalledTimes(1);
    t += DELIVERABILITY_CACHE_MS + 1;
    await checkDomainDeliverability("c.test", { resolver: r, now });
    expect(mx).toHaveBeenCalledTimes(2);

    const flaky = vi.fn(async () => { throw err("ESERVFAIL"); });
    const r2 = resolver({ resolveMx: flaky });
    await checkDomainDeliverability("d.test", { resolver: r2, now });
    await checkDomainDeliverability("d.test", { resolver: r2, now });
    expect(flaky).toHaveBeenCalledTimes(2);
  });
});
