import { createTheme } from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface TypeBackground {
    secondary: string;
  }
}

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "class" },
  colorSchemes: {
    light: {
      palette: {
        background: {
          secondary: "#f0f0f0"
        },
        primary: {
          main: "#065dff",
        },
      }
    },
    dark: {
      palette: {
        background: {
          default: "#151515",
          paper: "#1e1e1e",
          secondary: "#1e1e1e"
        },
        primary: {
          main: "#007bff",
        },
      },
    },
  },
  defaultColorScheme: "dark",
  components: {
    MuiPaper: {
      styleOverrides: {
        // MUI's shadow for the paper's elevation with the y offset set to 0, so it's
        // centered. Each shadow is up to three "x y blur spread color" layers.
        elevation: ({ ownerState, theme }) => ({
          boxShadow: theme.shadows[ownerState.elevation ?? 1]?.replace(
            /(^|,)(-?\d+px) -?\d+px/g,
            "$1$2 0px",
          ),
        }),
      },
    },
  },
});
