"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type MentionMember = {
  id: string;
  name: string | null;
  email: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  members: MentionMember[];
  placeholder?: string;
  className?: string;
  rows?: number;
  disabled?: boolean;
  id?: string;
  name?: string;
};

/**
 * Textarea with @-trigger autocomplete. The underlying value stores
 * mentions as `@[user-id]` tokens so renames and email changes don't
 * break references. The picker filters by display name + email.
 */
export function MentionTextarea({
  value,
  onChange,
  members,
  placeholder,
  className,
  rows = 4,
  disabled,
  id,
  name,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [triggerStart, setTriggerStart] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (!open) return [];
    const q = query.trim().toLowerCase();
    if (!q) return members.slice(0, 8);
    return members
      .filter((m) => {
        const hay = `${m.name ?? ""} ${m.email}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [members, open, query]);

  const closePicker = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlight(0);
    setTriggerStart(null);
  }, []);

  function findActiveTrigger(text: string, caret: number): number | null {
    for (let i = caret - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === "@") {
        if (i === 0 || /\s/.test(text[i - 1] ?? "")) return i;
        return null;
      }
      if (!ch || /\s/.test(ch)) return null;
    }
    return null;
  }

  function handleChange(next: string, caret: number) {
    onChange(next);
    const trigger = findActiveTrigger(next, caret);
    if (trigger === null) {
      closePicker();
      return;
    }
    setTriggerStart(trigger);
    setQuery(next.slice(trigger + 1, caret));
    setOpen(true);
    setHighlight(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(filtered[highlight]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePicker();
    }
  }

  function pick(member: MentionMember) {
    const ta = textareaRef.current;
    if (!ta || triggerStart === null) return;
    const before = value.slice(0, triggerStart);
    const after = value.slice(ta.selectionStart);
    const insert = `@[${member.id}] `;
    const next = `${before}${insert}${after}`;
    onChange(next);
    closePicker();
    requestAnimationFrame(() => {
      const pos = before.length + insert.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        closePicker();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [closePicker]);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        id={id}
        name={name}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        className={className ?? "aur-input min-h-[80px] resize-y"}
        onChange={(e) =>
          handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)
        }
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-white/10 bg-canvas shadow-card">
          <div className="border-b border-white/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
            Tag a teammate
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {filtered.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(m);
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${
                    i === highlight
                      ? "bg-white/[0.06] text-text"
                      : "text-muted hover:bg-white/[0.03] hover:text-text"
                  }`}
                >
                  <span className="truncate font-display text-[13px]">
                    {m.name ?? m.email}
                  </span>
                  <span className="truncate font-mono text-[10px] text-subtle">
                    {m.email}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
