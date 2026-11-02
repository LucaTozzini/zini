import type { ReactNode } from "react";
import { Stack } from "@mui/material";

// The column every sidebar sits in: the start screen's and each project's.
const Sidebar = ({ children }: { children: ReactNode }) => (
  <Stack
    useFlexGap
    spacing={2}
    sx={{
      height: "100%",
      px: 1,
      py: 1.5,
      bgcolor: "background.paper",
      width: 280,
      maxWidth: "100%",
      userSelect: "none",
      overflow: "auto",
    }}
  >
    {children}
  </Stack>
);

export default Sidebar;
