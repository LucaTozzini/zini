import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  type TypographyProps,
} from "@mui/material";
import { useMemo, type ComponentProps } from "react";
import { Link as RouterLink } from "react-router";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import LaunchIcon from "@mui/icons-material/Launch";

// A markdown element as MUI Typography, so it follows the theme's type scale. The
// variants are a step or two smaller than the tags': the text sits in a chat bubble
// or a card, not a page. Typography has no margins, so they're set here.
const text =
  (variant: TypographyProps["variant"], component: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p") =>
  ({ node: _node, ...props }: ComponentProps<typeof component> & ExtraProps) => (
    <Typography variant={variant} component={component} {...props} sx={component === "p" ? { mb: 1 } : { mt: 2, mb: 1 }} />
  );

const markdownComponents: Components = {
  h1: text("h5", "h1"),
  h2: text("h6", "h2"),
  h3: text("subtitle1", "h3"),
  h4: text("subtitle2", "h4"),
  h5: text("subtitle2", "h5"),
  h6: text("subtitle2", "h6"),
  p: text("body1", "p"),
  table: ({ node: _node, ...props }) => (
    <TableContainer sx={{ my: 1, maxWidth: "100%", overflowX: "auto" }}>
      <Table size="small" {...props} />
    </TableContainer>
  ),
  thead: ({ node: _node, ...props }) => <TableHead {...props} />,
  tbody: ({ node: _node, ...props }) => <TableBody {...props} />,
  tr: ({ node: _node, ...props }) => <TableRow {...props} />,
  th: ({ node: _node, align, ...props }) => (
    <TableCell component="th" {...props} align={align === "char" ? undefined : align} sx={{ fontWeight: 600 }} />
  ),
  td: ({ node: _node, align, ...props }) => <TableCell component="td" {...props} align={align === "char" ? undefined : align} />,
  // Inline code, and the code in a fenced block.
  code: ({ node: _node, ...props }) => (
    <Typography variant="body2" component="code" {...props} sx={{ color: "inherit", fontFamily: "monospace" }} />
  ),
  // A fenced block scrolls sideways for its long lines, instead of running out of the
  // bubble.
  pre: ({ node: _node, ...props }) => (
    <Box
      component="pre"
      {...props}
      sx={{
        overflowX: "auto",
        bgcolor: "black",
        p: 1,
        borderRadius: 1,
        color: "white",
      }}
    />
  ),
  // Links open in a new tab instead of replacing the chat. noreferrer also stops the
  // new page from reaching back into this one through window.opener.
  a: ({ node: _node, ...props }) => <ExternalLink {...props} />,
};

function ExternalLink(props: ComponentProps<"a">) {
  return (
    <Typography component={"a"} {...props} target="_blank" rel="noreferrer" sx={{ color: "DarkSeaGreen" }}>
      <LaunchIcon sx={{ fontSize: 12, mx: 0.3 }} />
      {props.children}
    </Typography>
  );
}

// Where a link goes instead of its href: a route in the app (opened in place), or
// another URL (opened in a new tab). undefined keeps the href.
export type LinkTarget = { to: string } | { href: string } | undefined;

// Markdown text (an agent's reply, an issue description), without its outer
// paragraph margins. resolveLink, if given, decides where each link goes.
function MarkdownText({
  children,
  resolveLink,
  ...props
}: { children: string; resolveLink?: (href: string) => LinkTarget } & TypographyProps<"div">) {
  const components = useMemo<Components>(
    () =>
      resolveLink
        ? {
            ...markdownComponents,
            a: ({ node: _node, href, ...linkProps }) => {
              const target = href ? resolveLink(href) : undefined;
              if (target && "to" in target)
                return (
                  <Typography component={RouterLink} to={target.to} sx={{ color: "primary.main" }}>
                    {linkProps.children}
                  </Typography>
                );
              return <ExternalLink {...linkProps} href={target?.href ?? href} />;
            },
          }
        : markdownComponents,
    [resolveLink],
  );

  return (
    <Typography
      component="div"
      {...props}
      sx={[
        // overflowWrap: long words with nowhere to break (paths, URLs, inline code) break
        // anywhere rather than overflow.
        {
          overflowWrap: "anywhere",
          "& > :first-child": { mt: 0 },
          "& > :last-child": { mb: 0 },
        },
        ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
      ]}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </Typography>
  );
}

export default MarkdownText;
