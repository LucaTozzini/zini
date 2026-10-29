import { useId, useState, type ReactNode } from "react";
import { Box, Collapse, List, ListItem, ListItemButton, ListItemText, Typography } from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useLocation } from "react-router";

export default function NavigationGroup({
  title,
  icon,
  count,
  defaultOpen,
  active,
  children,
}: {
  title: string;
  icon?: ReactNode;
  // How many items the group holds; undefined while loading.
  count?: number;
  defaultOpen: boolean;
  active: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const { pathname } = useLocation();
  const [expanded, setExpanded] = useState(defaultOpen);
  const [collapsedRoute, setCollapsedRoute] = useState<string | null>(null);
  // Reveal a selected issue on navigation, while allowing manual collapse on that page.
  const open = expanded || (active && collapsedRoute !== pathname);
  return (
    <ListItem disablePadding sx={{ display: "block" }}>
      <ListItemButton
        aria-expanded={open}
        aria-controls={id}
        sx={{ px: 1, py: 0.25, gap: 1, borderRadius: 1, minHeight: 30, color: "text.secondary" }}
        onClick={() => {
          setExpanded(!open);
          setCollapsedRoute(open ? pathname : null);
        }}
      >
        {icon && <Box sx={{ display: "inline-flex", "& .MuiSvgIcon-root": { fontSize: 14 } }}>{icon}</Box>}
        <ListItemText
          sx={{ my: 0, flex: "0 1 auto" }}
          primary={title}
          slotProps={{ primary: { variant: "body2", noWrap: true, sx: { fontWeight: 600, color: "text.primary" } } }}
        />
        {/* Muted, right after the title, so the count reads as part of it. */}
        {count !== undefined && (
          <Typography
            variant="caption"
            aria-label={`${count} issues`}
            sx={{ ml: -0.5, color: "text.disabled", fontVariantNumeric: "tabular-nums" }}
          >
            {count}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <ChevronRightIcon sx={{ fontSize: 16, transition: "transform 150ms", transform: open ? "rotate(90deg)" : "none" }} />
      </ListItemButton>
      <Collapse in={open} unmountOnExit>
        <List id={id} disablePadding aria-label={title} sx={{ pl: 1, ml: 1.75, borderLeft: 1, borderColor: "divider" }}>
          {children}
        </List>
      </Collapse>
    </ListItem>
  );
}
