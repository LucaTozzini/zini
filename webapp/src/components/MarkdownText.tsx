import { Box, Typography, type TypographyProps } from "@mui/material";
import type { ComponentProps } from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

// A markdown element as MUI Typography, so it follows the theme's type scale. The
// variants are a step or two smaller than the tags': the text sits in a chat bubble
// or a card, not a page. Typography has no margins, so they're set here.
const text =
  (variant: TypographyProps["variant"], component: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p") =>
  ({ node: _node, ...props }: ComponentProps<typeof component> & ExtraProps) => (
    <Typography
      variant={variant}
      component={component}
      {...props}
      sx={component === "p" ? { mb: 1 } : { mt: 2, mb: 1 }}
    />
  );

const markdownComponents: Components = {
  h1: text("h5", "h1"),
  h2: text("h6", "h2"),
  h3: text("subtitle1", "h3"),
  h4: text("subtitle2", "h4"),
  h5: text("subtitle2", "h5"),
  h6: text("subtitle2", "h6"),
  p: text("body1", "p"),
  // Inline code, and the code in a fenced block.
  code: ({ node: _node, ...props }) => (
    <Box component="code" {...props} sx={{ color: "secondary.main" }} />
  ),
  // Links open in a new tab instead of replacing the chat. noreferrer also stops the
  // new page from reaching back into this one through window.opener.
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

// Markdown text (an agent's reply, an issue description), without its outer
// paragraph margins.
function MarkdownText({ children, ...props }: { children: string } & TypographyProps<"div">) {
  return (
    <Typography
      component="div"
      {...props}
      sx={[
        { "& > :first-child": { mt: 0 }, "& > :last-child": { mb: 0 } },
        ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
      ]}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </Markdown>
    </Typography>
  );
}

export default MarkdownText;
