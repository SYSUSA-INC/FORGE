# FORGE documentation

- **[USER_MANUAL.md](USER_MANUAL.md)** — how to use FORGE day-to-day
- **[ADMIN_MANUAL.md](ADMIN_MANUAL.md)** — organization admin and platform superadmin tasks

## Screenshots

Drop PNG/JPG screenshots into `docs/images/` using the filenames referenced by the manuals:

```
docs/images/
├── sign-up.png
├── verify-email.png
├── sign-in.png
├── app-shell.png
├── settings-org.png
├── settings-samgov-sync.png
├── opportunities-list.png
├── opportunities-import.png
├── opportunities-new.png
├── opportunity-detail.png
├── opportunity-evaluation.png
├── opportunity-competitors.png
├── opportunity-activity.png
├── proposals-list.png
├── proposal-new.png
├── proposal-detail-header.png
├── proposal-sections.png
├── proposal-reviews.png
├── proposal-compliance.png
├── companies-list.png
├── companies-search.png
├── company-detail.png
├── users-page.png
├── users-invite.png
├── users-members.png
├── admin-portal.png
├── admin-organizations.png
└── admin-users.png
```

### Capturing screenshots

1. Sign in to https://www.sysgov.com
2. Navigate to the feature
3. Browser screenshot tool — crop to the relevant content area
4. Save with the exact filename from the list
5. `git add docs/images/<file>.png && git commit && git push`

A missing image renders as a broken-image icon in GitHub Markdown preview but doesn't break anything.

## Keeping the manuals in sync with the code

When you ship a PR that changes a feature visible in the manual:

1. Update the relevant `USER_MANUAL.md` or `ADMIN_MANUAL.md` section in the same PR
2. Re-capture any affected screenshots and include them in the same PR
3. In the PR description, note which manual sections changed

This keeps the docs a true reflection of the current app state.
