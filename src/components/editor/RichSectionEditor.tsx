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
import { useCallback, useEffect, useMemo } from "react";
import type { TipTapDoc } from "@/db/schema";

type Props = {
  doc: TipTapDoc;
  onChange: (doc: TipTapDoc, plain: string, words: number) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function RichSectionEditor({
  doc,
  onChange,
  placeholder,
  disabled,
}: Props) {
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: "tiptap-codeblock" } },
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
    ],
    [placeholder],
  );

  const editor = useEditor({
    extensions,
    content: doc,
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
      </div>
      <EditorContent editor={editor} />
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
