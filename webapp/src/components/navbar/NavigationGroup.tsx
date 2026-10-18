import { useId, useState, type ReactNode } from "react";
import { Box, Collapse, List, ListItem, ListItemButton, ListItemText } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useLocation } from "react-router";

export default function NavigationGroup({
  title,
  defaultOpen,
  active,
  children,
}: {
  title: string;
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
        sx={{ px: 0.5, py: 0.25, borderRadius: 0.5, minHeight: { xs: 32, md: 26 } }}
        onClick={() => {
          setExpanded(!open);
          setCollapsedRoute(open ? pathname : null);
        }}
      >
        {open ? (
          <ExpandMoreIcon sx={{ fontSize: 14, mr: 0.5, color: "text.secondary" }} />
        ) : (
          <ChevronRightIcon sx={{ fontSize: 14, mr: 0.5, color: "text.secondary" }} />
        )}
        <ListItemText sx={{ my: 0 }} primary={title} slotProps={{ primary: { variant: "body2", sx: { fontWeight: 600 } } }} />
      </ListItemButton>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 1.5 }}>
          <List id={id} disablePadding aria-label={title}>
            {children}
          </List>
        </Box>
      </Collapse>
    </ListItem>
  );
}
