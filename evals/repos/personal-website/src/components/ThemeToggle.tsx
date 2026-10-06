import { IconButton, Tooltip } from "@mui/material";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import type { ColorModeSetting } from "../theme";

const ORDER: ColorModeSetting[] = ["system", "light", "dark"];

const ICONS = {
  system: SettingsBrightnessIcon,
  light: LightModeIcon,
  dark: DarkModeIcon,
} as const;

const ThemeToggle = ({
  mode,
  onChange,
}: {
  mode: ColorModeSetting;
  onChange: (mode: ColorModeSetting) => void;
}) => {
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
  const Icon = ICONS[mode];

  return (
    <Tooltip title={`Theme: ${mode} — switch to ${next}`}>
      <IconButton
        onClick={() => onChange(next)}
        color="inherit"
        aria-label={`Color theme: ${mode}. Activate to switch to ${next}.`}
      >
        <Icon />
      </IconButton>
    </Tooltip>
  );
};

export default ThemeToggle;
