"use client";

import { useMemo } from "react";

const MENTION_REGEX = /@\[([a-zA-Z0-9_\-]+)\]/g;

export type MentionResolver = Map<string, string>;

/**
 * Renders a comment body, replacing `@[user-id]` tokens with chips.
 */
export function MentionText({
  body,
  resolver,
}: {
  body: string;
  resolver: MentionResolver;
}) {
  const parts = useMemo(() => {
    const out: { kind: "text" | "mention"; value: string }[] = [];
    let lastIndex = 0;
    for (const m of body.matchAll(MENTION_REGEX)) {
      const start = m.index ?? 0;
      if (start > lastIndex) {
        out.push({ kind: "text", value: body.slice(lastIndex, start) });
      }
      const id = m[1] ?? "";
      out.push({ kind: "mention", value: resolver.get(id) ?? "user" });
      lastIndex = start + m[0].length;
    }
    if (lastIndex < body.length) {
      out.push({ kind: "text", value: body.slice(lastIndex) });
    }
    return out;
  }, [body, resolver]);

  return (
    <>
      {parts.map((p, i) =>
        p.kind === "mention" ? (
          <span
            key={i}
            className="rounded bg-teal/10 px-1 py-0.5 font-medium text-teal"
          >
            @{p.value}
          </span>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </>
  );
}
