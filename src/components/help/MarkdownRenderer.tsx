"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownRenderer({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-text">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="mt-10 border-b border-white/10 pb-2 font-display text-2xl font-semibold tracking-tight text-text">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mt-8 font-display text-lg font-semibold text-text">
            {children}
          </h3>
        ),
        h4: ({ children }) => (
          <h4 className="mt-6 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
            {children}
          </h4>
        ),
        p: ({ children }) => (
          <p className="mt-4 font-body text-[15px] leading-relaxed text-muted">
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul className="mt-3 list-disc space-y-1 pl-6 font-body text-[15px] leading-relaxed text-muted marker:text-teal">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mt-3 list-decimal space-y-1 pl-6 font-body text-[15px] leading-relaxed text-muted marker:text-teal">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-teal underline decoration-teal/40 underline-offset-2 hover:decoration-teal"
            target={href?.startsWith("http") ? "_blank" : undefined}
            rel={href?.startsWith("http") ? "noreferrer" : undefined}
          >
            {children}
          </a>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-text">{children}</strong>
        ),
        em: ({ children }) => <em className="text-text">{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="mt-4 border-l-2 border-teal/50 bg-white/[0.03] px-4 py-2 text-muted">
            {children}
          </blockquote>
        ),
        code: ({ children, ...props }) => {
          // @ts-expect-error react-markdown passes inline at runtime
          const inline = props.inline as boolean | undefined;
          if (inline) {
            return (
              <code className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[12.5px] text-text">
                {children}
              </code>
            );
          }
          return (
            <code className="block font-mono text-[12.5px] leading-relaxed text-text">
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="mt-4 overflow-x-auto rounded-lg border border-white/10 bg-black/30 p-4">
            {children}
          </pre>
        ),
        hr: () => <hr className="my-10 border-white/10" />,
        table: ({ children }) => (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse border border-white/10 font-body text-sm">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-white/[0.04]">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="border border-white/10 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-white/10 px-3 py-2 text-muted">
            {children}
          </td>
        ),
        img: ({ src, alt }) => (
          <span className="mt-4 block rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-6 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-subtle">
            screenshot · {alt || src}
          </span>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}
