/**
 * BL-FB-CHAT-SLASH — slash commands in the section chat.
 *
 * Power-user shortcuts for the instructions authors type most: each
 * command expands to a full, structured instruction the model receives,
 * while the thread stores and shows what the author typed ("/shrink-by
 * 30%"). The expansion is the whole interface: the chat route and the
 * server action validate a command before any gate is spent, and
 * `prepareSectionChat` expands command-shaped user turns (the new one
 * and the history) for the model. Pure; shared by server and client.
 */

export type ChatCommand = {
  /** The token after the slash. */
  name: string;
  usage: string;
  description: string;
  takesArgs: "none" | "optional" | "required";
  argsHint?: string;
};

export const CHAT_COMMANDS: readonly ChatCommand[] = [
  {
    name: "win-theme",
    usage: "/win-theme [theme]",
    description: "Rewrite the draft so it reinforces the win themes, or one named theme",
    takesArgs: "optional",
    argsHint: "a theme number or title",
  },
  {
    name: "shrink-by",
    usage: "/shrink-by 30%",
    description: "Cut the draft by a share, a word count or a page count, keeping every fact",
    takesArgs: "required",
    argsHint: "30% · 200 words · 1 page",
  },
  {
    name: "add-citation",
    usage: "/add-citation",
    description: "Mark every concrete claim with its source or [NEEDS CITATION]",
    takesArgs: "none",
  },
  {
    name: "check-compliance",
    usage: "/check-compliance",
    description: "Check the draft against the requirements mapped to this section",
    takesArgs: "none",
  },
  {
    name: "voc",
    usage: "/voc",
    description: "Rewrite in the customer's own words where the topic matches",
    takesArgs: "none",
  },
];

export type ParsedSlashCommand = { name: string; args: string; raw: string };

/** A slash, a letter-led token, then optional arguments. "/ is" and "/3 pages" are prose. */
const COMMAND_RE = /^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/i;

/** The command token and its arguments, or null when the text is not shaped like a command. */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const raw = text.trim();
  const m = COMMAND_RE.exec(raw);
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), args: (m[2] ?? "").trim(), raw };
}

export function findCommand(name: string): ChatCommand | undefined {
  const n = name.trim().toLowerCase().replace(/^\//, "");
  return CHAT_COMMANDS.find((c) => c.name === n);
}

/** Commands whose name starts with the typed token (with or without the slash); all when empty. */
export function suggestCommands(prefix: string): ChatCommand[] {
  const p = prefix.trim().toLowerCase().replace(/^\//, "");
  return CHAT_COMMANDS.filter((c) => c.name.startsWith(p));
}

export type ShrinkTarget = { kind: "percent" | "words" | "pages"; value: number };

/** "30%", "30 percent", "200 words", "1 page", "1.5 pages"; a bare number under 100 is a percent. */
export function parseShrinkTarget(args: string): ShrinkTarget | null {
  const a = args.trim().toLowerCase();
  if (!a) return null;
  let m = /^(\d+(?:\.\d+)?)\s*(?:%|percent)$/.exec(a);
  if (m) {
    const value = Number(m[1]);
    return value > 0 && value < 100 ? { kind: "percent", value } : null;
  }
  m = /^(\d+)\s*(?:words?|w)$/.exec(a);
  if (m) {
    const value = Number(m[1]);
    return value > 0 ? { kind: "words", value } : null;
  }
  m = /^(\d+(?:\.\d+)?)\s*(?:pages?|pg|p)$/.exec(a);
  if (m) {
    const value = Number(m[1]);
    return value > 0 ? { kind: "pages", value } : null;
  }
  m = /^(\d+)$/.exec(a);
  if (m) {
    const value = Number(m[1]);
    return value > 0 && value < 100 ? { kind: "percent", value } : value >= 100 ? { kind: "words", value } : null;
  }
  return null;
}

export const SHRINK_USAGE = "Usage: /shrink-by 30% · /shrink-by 200 words · /shrink-by 1 page";

export type SlashExpansion =
  | { ok: true; command: ChatCommand; args: string; instruction: string; label: string }
  | { ok: false; command: ChatCommand | null; error: string };

const BODY_ONLY = "Return the full revised section body only — no preamble, no commentary about what you changed.";

/**
 * null when the text is not a command; otherwise the instruction the
 * model receives and a short label for the thread, or a usage error.
 */
export function expandSlashCommand(text: string): SlashExpansion | null {
  const parsed = parseSlashCommand(text);
  if (!parsed) return null;
  const command = findCommand(parsed.name);
  if (!command) {
    return { ok: false, command: null, error: `Unknown command "/${parsed.name}". Type / to see the commands.` };
  }
  const args = parsed.args;
  switch (command.name) {
    case "win-theme": {
      const target = args
        ? /^\d+$/.test(args)
          ? `win theme ${args}`
          : `the win theme "${args}"`
        : "every win theme listed in the context";
      return {
        ok: true,
        command,
        args,
        label: args ? `Reinforce ${/^\d+$/.test(args) ? `win theme ${args}` : `"${args}"`}` : "Reinforce the win themes",
        instruction: `Rewrite the current draft so that it reinforces ${target} throughout. Show each theme through the section's own substance — evidence, numbers, named approaches — never by quoting the theme's title, and never force a theme into a paragraph about something else. Keep the structure, every fact, citation marker and requirement reference. ${BODY_ONLY}`,
      };
    }
    case "shrink-by": {
      const t = parseShrinkTarget(args);
      if (!t) return { ok: false, command, error: SHRINK_USAGE };
      const amount =
        t.kind === "percent"
          ? `about ${t.value}%`
          : t.kind === "words"
            ? `about ${t.value} words`
            : `about ${t.value} page${t.value === 1 ? "" : "s"} (at 350 words per page)`;
      return {
        ok: true,
        command,
        args,
        label: `Shrink by ${t.kind === "percent" ? `${t.value}%` : `${t.value} ${t.kind === "words" ? "words" : t.value === 1 ? "page" : "pages"}`}`,
        instruction: `Cut the current draft by ${amount}. Remove filler, hedging and repetition first, then merge sentences that say the same thing. Preserve every concrete fact, number, date, name, citation marker and requirement reference, and keep the paragraph order. ${BODY_ONLY}`,
      };
    }
    case "add-citation":
      return {
        ok: true,
        command,
        args,
        label: "Add citations",
        instruction: `Go through the current draft sentence by sentence. After every concrete claim — contract or customer names, dollar values, dates, durations, quantities, metrics, certifications, named staff, past-performance facts — add an inline marker: the source in brackets when the context supports the claim (a requirement number such as [L.5.2.1], a past-performance record, an attached document's name), otherwise "[NEEDS CITATION]". Change no other words. Return the full section body with the markers only.`,
      };
    case "check-compliance":
      return {
        ok: true,
        command,
        args,
        label: "Check compliance",
        instruction: `Check the current draft against the requirements mapped to this section in the context, then the rest of the solicitation context. For each requirement, one line: its number, then ADDRESSED, PARTLY or MISSING, then the sentence of the draft that addresses it in quotes, or what is missing. Finish with the counts (addressed / partly / missing) and the three gaps to close first. Do not rewrite the section.`,
      };
    case "voc":
      return {
        ok: true,
        command,
        args,
        label: "Rewrite in the customer's voice",
        instruction: `Rewrite the current draft in the customer's voice. Where a paragraph is about the same thing as one of the customer's own words in the context, say it in their words or a close paraphrase so the evaluator reads their own vocabulary; never force a phrase into an unrelated paragraph, never string several together, never say that you are mirroring the solicitation. If the context carries none of the customer's words, say so in one line instead. Change nothing else — same facts, structure and length. ${BODY_ONLY}`,
      };
    default:
      return { ok: false, command, error: `"/${command.name}" is not available yet.` };
  }
}

/** The thread's label for a command turn ("Shrink by 30%"), or null for ordinary text. */
export function describeSlashCommand(text: string): string | null {
  const e = expandSlashCommand(text);
  return e && e.ok ? e.label : null;
}

/** What the model reads for a user turn: the expansion of a valid command, else the text itself. */
export function messageForModel(text: string): string {
  const e = expandSlashCommand(text);
  return e && e.ok ? e.instruction : text;
}
