# FORGE — Multi-Factor Authentication Setup

**Status:** REQUIRED for every account that can touch FORGE infrastructure.
**Last updated:** 2026-06-16

Every account that has access to source code, deploy controls, secrets, customer data, or AI APIs **must** have MFA enabled. This is the single highest-leverage security control we have at zero cost.

If you can't get MFA enabled on a given account, that account should not have privileged access.

---

## 1. Accounts requiring MFA

| Account | URL | Why it matters |
|---|---|---|
| GitHub (sysusa-inc org) | https://github.com/settings/security | Source control, secret scanning, deploy keys |
| Vercel | https://vercel.com/account/security | Deploy controls, env vars, prod redeploys |
| Neon | https://console.neon.tech | DB access, PITR, branch creation |
| Anthropic console | https://console.anthropic.com | AI API keys ($$$) |
| Resend | https://resend.com/settings | Email delivery, sender domain |
| AWS root account (when we create one) | https://signin.aws.amazon.com | Full AWS controls (highest-privilege account in existence) |
| AWS IAM users (when we create them) | per-user setup | Day-to-day AWS access |
| Domain registrar (forge.app or wherever) | varies | DNS — if hijacked, attacker controls everything |
| Email account for password resets | varies | Recovery of all of the above |

---

## 2. Recommended MFA method

**Hardware security key (YubiKey) > TOTP app (Authy/1Password) > SMS.**

**Why:**
- **Hardware key:** phishing-resistant. Even if a user gets tricked into typing creds into a fake site, the key won't authenticate against the wrong domain.
- **TOTP app:** fine for most cases. Vulnerable to phishing if the attacker proxies the OTP in real time, but rare.
- **SMS:** the worst option. SIM swap attacks are routine. **Avoid SMS for any privileged account.**

For founder + engineering lead, use a hardware key. Cost: $50-70 per key, recommend two per person (backup).

---

## 3. Per-account setup

### GitHub (5 min)

1. https://github.com/settings/security
2. **Enable two-factor authentication** → choose **security key** (or TOTP app if no hardware key)
3. Save 16 recovery codes in a password manager
4. Enable **mandatory MFA at the organization level**: https://github.com/organizations/sysusa-inc/settings/security → **Require two-factor authentication**. This forces every collaborator to have MFA — non-compliant accounts are auto-removed after 7 days.

### Vercel (3 min)

1. https://vercel.com/account/security
2. **Enable Two-Factor Authentication** → TOTP app
3. Save recovery codes

### Neon (3 min)

1. https://console.neon.tech → top-right menu → **Account settings** → **Security**
2. Enable MFA via TOTP app
3. Save recovery codes

### Anthropic console (3 min)

1. https://console.anthropic.com → **Settings** → **Security**
2. Enable 2FA via TOTP app
3. Save recovery codes
4. Bonus: rotate API keys quarterly (see `docs/SECRETS_ROTATION.md`)

### Resend (3 min)

1. https://resend.com → user menu → **Security**
2. Enable 2FA via TOTP app

### Email account (varies, ~5 min)

If the email account that receives password reset emails has weak MFA, every account above is at risk via password reset. Set MFA on the email itself.

- Gmail: https://myaccount.google.com/security → enable 2-Step Verification with a security key
- Outlook: similar flow
- Other: check provider docs

### Domain registrar (varies)

- DNS hijack = full system compromise. The attacker repoints `forge.app` to a phishing site, intercepts password resets, takes over the company.
- Set MFA + **registrar lock** (a flag that prevents transfers).

---

## 4. Recovery codes

Every account above gives you a set of one-time recovery codes (usually 8-16). Store them in:

1. **Primary:** password manager (1Password, Bitwarden) under the account entry.
2. **Backup:** printed, stored in a physical safe.

**Do not:**
- Store recovery codes in plaintext in a Notes app
- Email them to yourself
- Keep them in the same place as the MFA device (defeats the point of MFA)

---

## 5. MFA enforcement at the org level

Once individual accounts are MFA-enabled:

- **GitHub:** as noted above, set org-wide mandatory MFA.
- **Vercel:** Vercel Pro plans support team-wide MFA enforcement via SAML SSO (requires Enterprise). For Pro, manually verify every team member has MFA enabled.
- **Neon:** Neon doesn't currently support org-wide MFA enforcement. We manually audit.

---

## 6. Audit cadence

Once per quarter (see `docs/COMPLIANCE_REVIEW_TEMPLATE.md`):

1. List every account in section 1 above
2. Confirm MFA is still enabled
3. Confirm recovery codes are still valid (regenerate if compromised)
4. Confirm no shared accounts exist (every privileged account should be tied to a named individual)
5. Remove accounts of any team members who left
