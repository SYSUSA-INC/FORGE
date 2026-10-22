# BL-STAB-8 owner decisions (2026-10-21, round 1) — record in docs/BACKLOG.md with the 8a design PR
- Rollout: sign everyone out once at release; re-enter password, then enrol before anything opens.
- Google/Microsoft sign-ins: FORGE's own second factor required too (every user).
- Lost authenticator + recovery codes: superadmin reset only, written reason, user emailed, all sessions end, re-enrol at next sign-in.
- Session length: 8 h idle, 24 h max (strictest option chosen over the recommended 12 h / 7 d).
Round 2 still to ask: passkeys (2nd factor vs passwordless; required for superadmins?), preview-deployment policy,
emergency off-switch, OAuth auto-link by email off + Entra tenant restriction, SIGNUP_MODE in production,
pending-session TTL / wrong-code limit, notification emails, multiple factors / recovery-code count.
Pre-existing bugs to fix in an 8a-0 foundations slice: OAuth link deletes account under invite_only (events.createUser);
disabled user bypass on first OAuth link + jwt ignores disabled; no session revocation (auth_session with sid);
safeRedirectTarget '/\' open redirect; invite/sign-up password overwrite; no sign-in rate limit + fail-open limiter;
HTML export serves raw template HTML inline; middleware authorized() dead (wrapper).
Map: scratchpad/map8.txt (full) and map8-brief.txt.
