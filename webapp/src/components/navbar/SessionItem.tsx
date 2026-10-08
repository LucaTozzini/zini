import { Box, CircularProgress, Typography, ListItem, ListItemButton } from "@mui/material";
import { Link } from "react-router";
import type { ReactNode } from "react";
import TimeAgo, { type Unit } from "react-timeago";

const unitAbbreviations = { second: "s", minute: "m", hour: "h", day: "d", week: "w", month: "mo", year: "y" };
const noSuffixFormatter = (value: number, unit: Unit) => unit === "second" ? "Now" : `${value}${unitAbbreviations[unit]}`;

type SessionItemProps = {
  itemId: string;
  title: string;
  updatedAt: string;
  selected: boolean;
  loading?: boolean;
  needsApproval?: boolean;
  leadingIcon?: ReactNode;
  onMenu?: (position: { top: number; left: number }) => void;
};

export default function SessionItem({ itemId, title, updatedAt, selected, loading, needsApproval, leadingIcon, onMenu }: SessionItemProps) {
  return <ListItem disablePadding>
    <ListItemButton component={Link} to={itemId} sx={{
      py: 0.375, px: 1, borderRadius: 0.5, gap: 0.75, minWidth: 0,
      minHeight: { xs: 32, md: 26 },
    }}
    aria-current={selected ? "page" : undefined}
    aria-haspopup={onMenu ? "menu" : undefined}
    aria-label={`${title}${needsApproval ? ", awaiting approval" : ""}${loading ? ", running" : ""}`}
    onContextMenu={onMenu ? (event) => {
      event.preventDefault(); event.stopPropagation();
      onMenu({ top: event.clientY, left: event.clientX });
    } : undefined}
    onKeyDown={onMenu ? (event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault(); event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onMenu({ top: rect.bottom, left: rect.left });
      }
    } : undefined}
    >
      {leadingIcon && <Box component="span" sx={{ display: "inline-flex", flexShrink: 0, color: "text.secondary" }}>{leadingIcon}</Box>}
      <Typography variant="body2" noWrap color={needsApproval ? "warning" : selected ? "textPrimary" : "textSecondary"}
        sx={{ minWidth: 0, flex: 1 }}>{title}</Typography>
      <Typography component="span" variant="body2" color="textSecondary" sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
        <TimeAgo date={updatedAt} formatter={noSuffixFormatter} />
      </Typography>
      {loading && <CircularProgress size={10} aria-label="Running" sx={{ flexShrink: 0 }} />}
    </ListItemButton>
  </ListItem>;
}
