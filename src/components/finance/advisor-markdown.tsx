"use client";

import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import "./advisor-markdown.css";

const remarkPlugins = [remarkGfm];
const components: Components = {
  table: ({ children }) => (
    <div className="advisor-markdown-table" role="region" aria-label="Response table" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }) => href
    ? <a href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer">{children}</a>
    : <span>{children}</span>,
  // Responses can describe images without loading arbitrary remote URLs.
  img: ({ alt }) => alt ? <span>{alt}</span> : null,
};

export const AdvisorMarkdown = memo(function AdvisorMarkdown({ children }: { children: string }) {
  return (
    <div className="advisor-markdown">
      <Markdown remarkPlugins={remarkPlugins} components={components} skipHtml>{children}</Markdown>
    </div>
  );
});
