import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders an article; links open in a new tab. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="article">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children: c }) => <a href={href} target="_blank" rel="noreferrer">{c}</a> }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
