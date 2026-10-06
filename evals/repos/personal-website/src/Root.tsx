import { useEffect, useMemo, useState } from "react";
import App from "./App.tsx";
import { ThemeProvider, useMediaQuery } from "@mui/material";
import CssBaseline from "@mui/material/CssBaseline";
import {
  buildTheme,
  type ColorModeSetting,
  type EffectiveColorMode,
} from "./theme";

const STORAGE_KEY = "color-mode";

function getInitialMode(): ColorModeSetting {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // storage unavailable; fall through to system
  }
  return "system";
}

function Root() {
  const [mode, setMode] = useState<ColorModeSetting>(getInitialMode);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const effectiveMode: EffectiveColorMode =
    mode === "system" ? (prefersDark ? "dark" : "light") : mode;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore write failures (private mode, etc.)
    }
  }, [mode]);

  const theme = useMemo(() => buildTheme(effectiveMode), [effectiveMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App colorMode={mode} onColorModeChange={setMode} />
    </ThemeProvider>
  );
}

export default Root;
