/**
 * BL-DOMAIN-FORGEAXI phase 2 — Resend reports a refused message (an
 * unverified sending domain, a bad address) in `error`, not by throwing.
 * sendEmail used to ignore it, so a refusal read as "sent". It now throws,
 * naming the domain problem, and every caller handles the error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  send.mockReset();
});

async function load() {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("EMAIL_FROM", "");
  return import("@/lib/email");
}

describe("sendEmail", () => {
  it("sends from the site's domain and returns when Resend accepts", async () => {
    send.mockResolvedValue({ data: { id: "e1" }, error: null });
    const { sendEmail } = await load();
    await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: expect.stringMatching(/^FORGE <noreply@[a-z0-9.-]+>$/) }));
  });

  it("throws when Resend refuses, naming an unverified domain", async () => {
    send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "The forgeaxi.com domain is not verified." } });
    const { sendEmail } = await load();
    await expect(sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" })).rejects.toThrow(/not verified.*verified in Resend/);
  });
});
