import { createTheme, responsiveFontSizes } from "@mui/material";
import type { Theme } from "@mui/material";

export type ColorModeSetting = "light" | "dark" | "system";
export type EffectiveColorMode = "light" | "dark";

export function buildTheme(mode: EffectiveColorMode): Theme {
  const isLight = mode === "light";

  return responsiveFontSizes(
    createTheme({
      palette: {
        mode,
        primary: {
          main: "#004add",
        },
        secondary: {
          main: "#dd7600",
        },
        background: isLight
          ? {
              default: "#f4f6f1",
              paper: "#ffffff",
            }
          : {
              default: "#0f130e",
              paper: "#1a2018",
            },
        text: isLight
          ? {
              primary: "#1e2a1f",
              secondary: "#5d6a5c",
            }
          : {
              primary: "#e8ece3",
              secondary: "#9aa394",
            },
      },
      typography: {
        h1: {
          fontWeight: 800,
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
        },
        h2: {
          fontWeight: 700,
          letterSpacing: "-0.01em",
        },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: (theme) => {
            const tintStart = theme.alpha(
              theme.palette.primary.main,
              isLight ? 0.07 : 0.12
            );
            const tintMid = theme.alpha(
              theme.palette.primary.main,
              isLight ? 0.02 : 0.04
            );

            return {
              html: {
                scrollBehavior: "smooth",
                colorScheme: mode,
              },
              body: {
                "&::before": {
                  content: '""',
                  position: "fixed",
                  inset: 0,
                  zIndex: -1,
                  pointerEvents: "none",
                  backgroundImage: `linear-gradient(160deg, ${tintStart} 0%, ${tintMid} 45%, ${theme.palette.background.default} 85%)`,
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "cover",
                  "@media print": {
                    display: "none",
                  },
                },
              },
              "::selection": {
                backgroundColor: theme.palette.secondary.main,
                color: isLight
                  ? theme.palette.common.white
                  : theme.palette.background.default,
              },
            };
          },
        },
        MuiTypography: {
          styleOverrides: {
            h2: ({ theme }) => ({
              "&::after": {
                content: '""',
                display: "block",
                width: 44,
                height: 4,
                borderRadius: 4,
                backgroundColor: theme.palette.primary.main,
                marginTop: theme.spacing(1.5),
              },
            }),
          },
        },
      },
    })
  );
}
