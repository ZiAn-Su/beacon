import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

// Render a message body as Markdown. Safe by default: react-markdown does NOT
// render raw HTML, so message content (which comes from agents and the human)
// cannot inject markup — only the formatting markdown allows. remark-gfm adds
// tables / strikethrough / autolinks; remark-breaks keeps a single newline as a
// line break (agents and humans write that way, matching the old pre-wrap feel).
//
// `onAccent` switches code / quote / border styling for the white-on-accent
// ("sent" / "mine") bubbles, where the light-surface tokens would be invisible.
export const Markdown = memo(function Markdown({
  text,
  onAccent = false,
}: {
  text: string;
  onAccent?: boolean;
}) {
  return (
    <div className={"md-body" + (onAccent ? " md-on-accent" : "")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          // Open links in a new tab, and never leak the opener / referrer.
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
