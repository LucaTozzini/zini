import type { ReactNode } from "react";
import { ListItemButton, ListItemIcon, ListItemText } from "@mui/material";
import { Link, useLocation } from "react-router";

// A sidebar link to a page, highlighted while that page (or one under it) is open.
// Without `to`, it's a button that runs onClick instead.
const NavBarItem = ({ title, icon, to, onClick }: { title: string; icon: ReactNode; to?: string; onClick?: () => void }) => {
  const { pathname } = useLocation();
  const selected = Boolean(to && (pathname === to || pathname.startsWith(`${to}/`)));
  const link = to ? { component: Link, to } : {};

  return (
    <ListItemButton
      {...link}
      onClick={onClick}
      selected={selected}
      aria-current={selected ? "page" : undefined}
      sx={{
        // ListItemButton grows by default, which stretches it inside the sidebar's column.
        flexGrow: 0,
        gap: 1.25,
        px: 1,
        py: 0.5,
        borderRadius: 1,
        minHeight: 32,
        color: selected ? "text.primary" : "text.secondary",
        "&:hover": { color: "text.primary" },
      }}
    >
      <ListItemIcon sx={{ minWidth: 0, color: "inherit", "& .MuiSvgIcon-root": { fontSize: 18 } }}>{icon}</ListItemIcon>
      <ListItemText sx={{ my: 0 }} primary={title} slotProps={{ primary: { variant: "body2", noWrap: true } }} />
    </ListItemButton>
  );
};

export default NavBarItem;
