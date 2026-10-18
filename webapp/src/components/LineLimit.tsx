import { Box, Button } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type LineLimitProps = {
  children: ReactNode;
  lineLimit?: number;
  fadeColor?: string;
};

// Accept palette paths as well as literal CSS colors, using CSS variables when available.
function resolveFadeColor(theme: Theme, color: string) {
  const value = color
    .split(".")
    .reduce<unknown>(
      (current, key) => (current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined),
      (theme.vars || theme).palette,
    );
  return typeof value === "string" ? value : color;
}

// Limits rendered height, so paragraphs, headings and code share the same budget.
// Give this component a content key when changes should reset its expanded state.
export default function LineLimit({ children, lineLimit = 12, fadeColor }: LineLimitProps) {
  const contentId = useId();
  const previewRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lines = Number.isFinite(lineLimit) ? Math.max(1, Math.floor(lineLimit)) : 12;

  useLayoutEffect(() => {
    const preview = previewRef.current;
    const content = contentRef.current;
    if (!preview || !content) return;
    const measure = () => {
      const limit = parseFloat(getComputedStyle(preview).lineHeight) * lines;
      setOverflows(content.scrollHeight > limit + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [children, lines]);

  return (
    <Box sx={{ position: "relative", overflow: "hidden", minWidth: 0 }}>
      <Box
        id={contentId}
        ref={previewRef}
        sx={{
          typography: "body1",
          overflow: "hidden",
          maxHeight: expanded ? "none" : `${lines}lh`,
        }}
      >
        <Box ref={contentRef}>{children}</Box>
      </Box>
      {overflows && (
        <Box
          sx={{
            background: (theme) => `linear-gradient(transparent, ${resolveFadeColor(theme, fadeColor ?? "background.default")})`,
            position: expanded ? "relative" : "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            pt: expanded ? 2 : 15,
          }}
        >
          <Button
            fullWidth
            size="small"
            color="inherit"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show less" : "Show more"}
          </Button>
        </Box>
      )}
    </Box>
  );
}
