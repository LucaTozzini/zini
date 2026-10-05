import { Box, ButtonBase, CircularProgress, Typography } from "@mui/material";
import type { MouseEventHandler, ReactNode } from "react";
import TimeAgo from "react-timeago";

import { type Unit } from "react-timeago";

import CircleIcon from "@mui/icons-material/Circle";

const dimOnHoverSx = {
  transition: "opacity 400ms",
  ":hover": {
    opacity: 0.6,
  },
};

const unitAbbreviations = {
  second: "s",
  minute: "m",
  hour: "h",
  day: "d",
  week: "w",
  month: "mo",
  year: "y",
};
// Custom formatter that ignores the 'suffix' argument
const noSuffixFormatter = (value: number, unit: Unit) =>
  `${value}${unitAbbreviations[unit]}`;

type SessionItemProps = {
  handleClick: () => void;
  title: string;
  updatedAt: string;
  selected: boolean;
  loading?: boolean;
  needsApproval?: boolean;
  leadingIcon?: ReactNode;
  handleContextMenu?: MouseEventHandler<HTMLDivElement>;
}
const SessionItem = ({ handleClick, title, updatedAt, selected, loading, needsApproval, leadingIcon, handleContextMenu }: SessionItemProps) => {
  return (
    <Box
      onContextMenu={handleContextMenu}
      sx={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        py: 0.5,
      }}
    >
      <ButtonBase
        onClick={handleClick}
        aria-current={selected ? "page" : undefined}
        aria-haspopup={handleContextMenu ? "menu" : undefined}
        sx={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          justifyContent: "flex-start",
          ...(selected ? {} : dimOnHoverSx),
        }}
      >
        <CircleIcon
          color="secondary"
          sx={{
            fontSize: 7,
            mr: 1,
            display: selected ? "block" : "none",
          }}
        />

        {leadingIcon && (
          <Box component="span" sx={{ display: "inline-flex", flexShrink: 0, mr: 1, color: "text.secondary" }}>
            {leadingIcon}
          </Box>
        )}

        <Typography
          variant="body2"
          noWrap
          color={needsApproval ? "warning" : selected ? "textPrimary" : "textSecondary"}
          sx={{
            mr: 3,
            minWidth: 0,
          }}
        >
          {title}
        </Typography>
        <Typography
          variant="body2"
          noWrap
          color="textSecondary"
          sx={{ flexShrink: 0, ml: "auto", pr: 0.5 }}
        >
          <TimeAgo date={updatedAt} formatter={noSuffixFormatter} />
          {loading && <CircularProgress size={10} aria-label="Loading…" sx={{ml: 1}}/>}
        </Typography>
      </ButtonBase>
    </Box>
  );
};

export default SessionItem;
