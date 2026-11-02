import { useState } from "react";
import { Link } from "react-router";
import { ButtonBase, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from "@mui/material";
import AppsIcon from "@mui/icons-material/Apps";
import CheckIcon from "@mui/icons-material/Check";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import { useProject, useProjects } from "../../api/projects.ts";
import { useProjectId } from "../../hooks/useProject.ts";
import ZiniIcon from "../icons/ZiniIcon.tsx";
import { sidebarHeaderSx } from "./sidebarHeader.ts";

const forges = (count: number) => (count ? `${count} Forge${count === 1 ? "" : "s"} running` : undefined);

// The project's name at the top of its sidebar, which opens a menu to switch to another
// project or go back to all of them.
const ProjectSwitcher = () => {
  const projectId = useProjectId();
  const project = useProject(projectId);
  const projects = useProjects();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);

  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        sx={{ ...sidebarHeaderSx, display: "flex", justifyContent: "flex-start", "&:hover": { bgcolor: "action.hover" } }}
      >
        <ZiniIcon sx={{ fontSize: 26 }} />
        <Typography
          variant="subtitle1"
          noWrap
          sx={{ fontWeight: 700, letterSpacing: "0.02em", flex: 1, minWidth: 0, textAlign: "left" }}
        >
          {project.data?.name ?? "zini"}
        </Typography>
        <UnfoldMoreIcon sx={{ fontSize: 18, color: "text.secondary" }} />
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { minWidth: 248 } }, list: { dense: true } }}
      >
        {projects.data?.map((p) => (
          <MenuItem key={p.id} component={Link} to={`/projects/${p.id}`} selected={p.id === projectId} onClick={close}>
            <ListItemText primary={p.name} secondary={forges(p.runningForges)} />
            {p.id === projectId && <CheckIcon fontSize="small" sx={{ ml: 2, color: "text.secondary" }} />}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem component={Link} to="/" onClick={close}>
          <ListItemIcon>
            <AppsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="All projects" />
        </MenuItem>
      </Menu>
    </>
  );
};

export default ProjectSwitcher;
