/**
 * @-mention parser for review comments.
 *
 * Format: @user-id (UUID-like or NextAuth's text id) — we render
 * `@username` in the UI but the backing token is the user id so
 * renamed users still resolve.
 *
 * Tokens are wrapped as @[id] so the UI can format them and the
 * backend can extract them without ambiguity.
 */

const MENTION_REGEX = /@\[([a-zA-Z0-9_\-]+)\]/g;

export function extractMentionUserIds(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION_REGEX)) {
    if (m[1]) ids.add(m[1]);
  }
  return Array.from(ids);
}

/**
 * Replace `@[id]` tokens with `@DisplayName` for plain-text email
 * bodies. Unknown ids are left as `@…` to avoid leaking raw tokens.
 */
export function renderMentionsToPlain(
  body: string,
  resolve: (id: string) => string | null,
): string {
  return body.replace(MENTION_REGEX, (_full, id: string) => {
    const name = resolve(id);
    return name ? `@${name}` : "@…";
  });
}

/**
 * Render mentions as inline HTML chips for in-app display.
 * Caller is responsible for HTML-escaping surrounding text.
 */
export function renderMentionsToHtml(
  body: string,
  resolve: (id: string) => string | null,
): string {
  return body.replace(MENTION_REGEX, (_full, id: string) => {
    const name = resolve(id) ?? "user";
    const safe = name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<span class="mention" data-user-id="${id}">@${safe}</span>`;
  });
}
