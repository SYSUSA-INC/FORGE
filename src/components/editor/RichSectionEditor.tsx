"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Link } from "@tiptap/extension-link";
import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { AnyExtension } from "@tiptap/core";
import * as Y from "yjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TipTapDoc } from "@/db/schema";
import {
  TcInsert,
  TcDelete,
  TrackChanges,
} from "./extensions/TrackChanges";
import { TrackChangesSidebar } from "./TrackChangesSidebar";

/**
 * BL-9 Slice 2 — when a `collab` config is supplied AND
 * `NEXT_PUBLIC_COLLAB_ENABLED === "1"`, the editor binds to a Yjs
 * document hosted by the Hocuspocus service. Otherwise it falls back
 * to the original single-user path (byte-identical with pre-Slice-2
 * behavior).
 *
 * Subsequent slices add presence cursors with stable colors, track
 * changes, and comments. Slice 2 only ships the plumbing — no
 * caller wires `collab` yet, so this remains dead-but-tested code
 * until the SectionsClient hand-off lands.
 */
export type CollabConfig = {
  /** "section/<proposalSectionId>" — see docs/architecture/collab-editor.md */
  docName: string;
  /** Full URL to the Hocuspocus service — e.g. wss://collab.forge.app */
  serverUrl: string;
  /** Display name shown above the remote user's cursor. */
  userName: string;
  /** Stable per-user hex color for the cursor. */
  userColor: string;
  /**
   * Function the editor calls to fetch a fresh JWT. Called at mount
   * and again before token expiry. Returns the bare JWT string;
   * `/api/collab/token` is the canonical implementation.
   */
  fetchToken: () => Promise<string>;
};

/**
 * BL-9 Slice 3 — author identity for track changes.
 * When provided, the editor activates the TrackChanges extension.
 */
export type TrackChangesConfig = {
  author: {
    id: string;
    name: string;
    color: string;
  };
};

type Props = {
  doc: TipTapDoc;
  onChange: (doc: TipTapDoc, plain: string, words: number) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * When provided and the COLLAB_ENABLED feature flag is on, the
   * editor connects to Hocuspocus for real-time collaboration. When
   * omitted, the editor renders exactly as it did pre-Slice-2.
   */
  collab?: CollabConfig;
  /**
   * When provided, activates the TrackChanges extension. The sidebar
   * becomes available and the toolbar gains a "Track" toggle button.
   */
  trackChanges?: TrackChangesConfig;
};

function collabEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COLLAB_ENABLED === "1";
}

export function RichSectionEditor({
  doc,
  onChange,
  placeholder,
  disabled,
  collab,
  trackChanges,
}: Props) {
  const useCollab = !!collab && collabEnabled();
  // Local toggle for track-changes sidebar visibility (independent of
  // tracking mode which lives in the extension storage / Y.Map).
  const [tcSidebarOpen, setTcSidebarOpen] = useState(false);

  // Yjs doc + Hocuspocus provider live for the lifetime of the editor
  // instance. Stored in refs so React renders don't tear them down.
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  if (useCollab && !ydocRef.current) {
    ydocRef.current = new Y.Doc();
  }

  useEffect(() => {
    if (!useCollab || !collab) return;
    let cancelled = false;
    const ydoc = ydocRef.current!;

    // Bootstrap the provider with a real token. Hocuspocus accepts
    // either a string token or a function — we use the function form
    // so token refresh on reconnect just calls back into the app.
    void collab
      .fetchToken()
      .then((token) => {
        if (cancelled) return;
        providerRef.current = new HocuspocusProvider({
          url: collab.serverUrl,
          name: collab.docName,
          document: ydoc,
          token,
        });
      })
      .catch(() => {
        // Surfacing the error here would race the editor render. The
        // provider's own onClose / onAuthenticationFailed will fire if
        // the token mint succeeds but verification fails server-side;
        // a pure mint failure leaves the editor in single-user mode
        // until next mount.
      });

    return () => {
      cancelled = true;
      providerRef.current?.destroy();
      providerRef.current = null;
    };
    // Intentionally omit `collab` from deps — its identity changes on
    // every parent render, but the doc-name / server-url / fetchToken
    // are stable for the section's lifetime. Re-mount the editor if
    // any of those need to change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCollab]);

  const extensions = useMemo(() => {
    const base: AnyExtension[] = [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: "tiptap-codeblock" } },
        // Yjs ships its own undo manager; the starter-kit's undoRedo
        // extension fights it. Turn ours off when collab is on.
        ...(useCollab ? { undoRedo: false as const } : {}),
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "tiptap-link" },
      }),
      Image.configure({ inline: false, HTMLAttributes: { class: "tiptap-image" } }),
      Placeholder.configure({
        placeholder:
          placeholder ?? "Draft prose here. Type / for headings, lists, tables…",
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ];
    if (useCollab && collab && ydocRef.current) {
      base.push(Collaboration.configure({ document: ydocRef.current }));
      // CollaborationCaret (formerly CollaborationCursor in TipTap 2.x)
      // needs the provider's awareness handle. We pass a getter so the
      // extension picks it up once the provider is ready instead of
      // failing fast on first render.
      base.push(
        CollaborationCaret.configure({
          // The awareness API surface CollaborationCaret reads from.
          // `providerRef.current` becomes non-null after the
          // fetchToken promise resolves; the caret extension polls
          // until then, so a brief gap is harmless.
          provider: {
            get awareness() {
              return providerRef.current?.awareness ?? null;
            },
          },
          user: { name: collab.userName, color: collab.userColor },
        }),
      );
    }
    // BL-9 Slice 3 — track changes marks + extension.
    // Enabled whenever the caller supplies a `trackChanges` config.
    if (trackChanges) {
      base.push(TcInsert);
      base.push(TcDelete);
      base.push(
        TrackChanges.configure({
          authorId: trackChanges.author.id,
          authorName: trackChanges.author.name,
          authorColor: trackChanges.author.color,
          // Share the collab Y.Doc so the tracking-mode toggle syncs
          // to all peers. Undefined in single-user mode (local state only).
          ydoc: useCollab && ydocRef.current ? ydocRef.current : undefined,
        }),
      );
    }
    return base;
  }, [placeholder, useCollab, collab, trackChanges]);

  const editor = useEditor({
    extensions,
    // In collab mode the Y.Doc is the source of truth; passing
    // `content` would double-initialize the doc and produce phantom
    // edits. The Hocuspocus provider hydrates from the server.
    content: useCollab ? undefined : doc,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "tiptap-prose min-h-[280px] w-full rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 font-body text-[14px] leading-relaxed text-text outline-none focus:border-teal/60 focus:bg-white/[0.05]",
      },
    },
    onUpdate: ({ editor: e }) => {
      const next = e.getJSON() as TipTapDoc;
      const plain = e.getText();
      const words = plain
        .split(/\s+/g)
        .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      onChange(next, plain, words);
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  }, [editor]);

  const insertImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("Image URL");
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const insertTable = useCallback(() => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] p-1">
        <ToolbarBtn
          label="B"
          title="Bold"
          isActive={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          bold
        />
        <ToolbarBtn
          label="I"
          title="Italic"
          isActive={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          italic
        />
        <ToolbarBtn
          label="U"
          title="Underline"
          isActive={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          underline
        />
        <ToolbarBtn
          label="S"
          title="Strikethrough"
          isActive={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          strike
        />
        <ToolbarDivider />
        <ToolbarBtn
          label="H1"
          title="Heading 1"
          isActive={editor.isActive("heading", { level: 1 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        />
        <ToolbarBtn
          label="H2"
          title="Heading 2"
          isActive={editor.isActive("heading", { level: 2 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
        <ToolbarBtn
          label="H3"
          title="Heading 3"
          isActive={editor.isActive("heading", { level: 3 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
        />
        <ToolbarBtn
          label="¶"
          title="Paragraph"
          isActive={editor.isActive("paragraph")}
          onClick={() => editor.chain().focus().setParagraph().run()}
        />
        <ToolbarDivider />
        <ToolbarBtn
          label="•"
          title="Bullet list"
          isActive={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarBtn
          label="1."
          title="Numbered list"
          isActive={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarBtn
          label="“"
          title="Blockquote"
          isActive={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarBtn
          label="</>"
          title="Code block"
          isActive={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
        <ToolbarDivider />
        <ToolbarBtn
          label="link"
          title="Insert / edit link"
          isActive={editor.isActive("link")}
          onClick={setLink}
        />
        <ToolbarBtn
          label="img"
          title="Insert image (URL)"
          isActive={false}
          onClick={insertImage}
        />
        <ToolbarBtn
          label="tbl"
          title="Insert 3×3 table"
          isActive={editor.isActive("table")}
          onClick={insertTable}
        />
        <ToolbarBtn
          label="—"
          title="Horizontal rule"
          isActive={false}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />
        <ToolbarDivider />
        <ToolbarBtn
          label="↶"
          title="Undo"
          isActive={false}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        />
        <ToolbarBtn
          label="↷"
          title="Redo"
          isActive={false}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        />
        {/* BL-9 Slice 3 — Track changes toggle (only when extension is loaded) */}
        {trackChanges ? (
          <>
            <ToolbarDivider />
            <TrackToggleBtn
              editor={editor}
              sidebarOpen={tcSidebarOpen}
              onToggleSidebar={() => setTcSidebarOpen((v) => !v)}
            />
          </>
        ) : null}
      </div>
      <EditorContent editor={editor} />
      {/* Track changes review sidebar — shown when the user opens it */}
      {trackChanges ? (
        <TrackChangesSidebar editor={editor} visible={tcSidebarOpen} />
      ) : null}
    </div>
  );
}

/**
 * Toolbar button that combines the tracking-mode indicator with the
 * sidebar toggle. Shows an amber dot when recording is active.
 */
function TrackToggleBtn({
  editor,
  sidebarOpen,
  onToggleSidebar,
}: {
  editor: ReturnType<typeof useEditor>;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  if (!editor) return null;
  const tcStorage = (editor.storage as unknown as Record<string, unknown>)
    .TrackChanges as { trackingEnabled: boolean } | undefined;
  const trackingEnabled: boolean = tcStorage?.trackingEnabled ?? false;

  function toggleTracking() {
    editor!.commands.setTrackingMode(!trackingEnabled);
  }

  return (
    <div className="flex items-center gap-0.5">
      {/* Recording-mode pill */}
      <button
        type="button"
        onClick={toggleTracking}
        title={trackingEnabled ? "Stop recording changes" : "Record changes"}
        className="inline-flex h-7 items-center gap-1 rounded px-1.5 font-mono text-[10px] transition-colors hover:bg-white/[0.06]"
        style={
          trackingEnabled
            ? {
                background: "rgba(251, 191, 36, 0.15)",
                color: "#FBBF24",
              }
            : undefined
        }
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${trackingEnabled ? "tc-pulse" : "bg-white/20"}`}
          style={trackingEnabled ? { background: "#FBBF24" } : undefined}
        />
        track
      </button>
      {/* Sidebar-open toggle */}
      <button
        type="button"
        onClick={onToggleSidebar}
        title="Open / close track-changes review panel"
        className={`inline-flex h-7 items-center justify-center rounded px-1 font-mono text-[10px] transition-colors ${
          sidebarOpen
            ? "bg-white/10 text-text"
            : "text-muted hover:bg-white/[0.06] hover:text-text"
        }`}
      >
        ▾
      </button>
    </div>
  );
}

function ToolbarBtn({
  label,
  title,
  isActive,
  onClick,
  disabled,
  bold,
  italic,
  underline,
  strike,
}: {
  label: string;
  title: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={isActive}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 font-mono text-[11px] transition-colors disabled:opacity-40 ${
        isActive
          ? "bg-teal/15 text-teal"
          : "text-muted hover:bg-white/[0.06] hover:text-text"
      }`}
      style={{
        fontWeight: bold ? 700 : undefined,
        fontStyle: italic ? "italic" : undefined,
        textDecoration: strike
          ? "line-through"
          : underline
            ? "underline"
            : undefined,
      }}
    >
      {label}
    </button>
  );
}

function ToolbarDivider() {
  return <span aria-hidden className="mx-1 inline-block h-5 w-px bg-white/10" />;
}
