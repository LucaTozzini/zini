import { Box, Container, Divider, Stack, Typography } from "@mui/material";
import MyAppBar from "./components/MyAppBar";
import Reveal from "./components/Reveal";
import Experience from "./components/Experience";
import Education from "./components/Education";
import Socials from "./components/Socials";
import type { ColorModeSetting } from "./theme";

function App({
  colorMode,
  onColorModeChange,
}: {
  colorMode: ColorModeSetting;
  onColorModeChange: (mode: ColorModeSetting) => void;
}) {
  return (
    <>
      <MyAppBar colorMode={colorMode} onColorModeChange={onColorModeChange} />
      <Container maxWidth="md" sx={{ pt: 10, pb: 4 }}>
        <Stack spacing={10}>
          <section>
            <Box
              role="img"
              aria-label="Aerial view of dark coastal cliffs at dusk"
              sx={{
                borderRadius: 6,
                boxShadow: 4,
                backgroundImage:
                  "linear-gradient(to top, rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.1)), url(/hero-landscape.jpg)",
                backgroundSize: "cover",
                backgroundPosition: "center",
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                p: { xs: 3, md: 5 },
                pt: { xs: 5, md: 10 },
                "@keyframes heroFadeUp": {
                  from: { opacity: 0, transform: "translateY(16px)" },
                  to: { opacity: 1, transform: "translateY(0)" },
                },
              }}
            >
              <Box
                sx={{
                  animation: "heroFadeUp 700ms ease both",
                  "@media (prefers-reduced-motion: reduce)": {
                    animation: "none",
                  },
                }}
              >
                <Typography
                  variant="overline"
                  sx={{ color: "white", fontWeight: "bolder", fontSize: 15 }}
                >
                  Welcome to my website!!
                </Typography>
                <Typography variant="h1" sx={{ color: "white" }}>
                  Hi, I'm Luca
                </Typography>
                <Typography
                  variant="h6"
                  sx={{ mt: 2, color: "rgba(255, 255, 255, 0.9)" }}
                >
                  I'm a software engineer currently
                  <br />
                  studying{" "}
                  <Box component={"span"} sx={{ color: "secondary.light" }}>
                    @
                  </Box>{" "}
                  UVic
                  <br />
                  working{" "}
                  <Box component={"span"} sx={{ color: "secondary.light" }}>
                    @
                  </Box>{" "}
                  RenoFiz
                </Typography>
              </Box>
            </Box>
          </section>

          <Reveal>
            <Experience />
          </Reveal>
          <Reveal>
            <Education />
          </Reveal>
          <Reveal>
            <Socials />
          </Reveal>
        </Stack>

        <Divider sx={{ mt: 10, mb: 4 }} />
        <Typography variant="body2" color="text.secondary" align="center">
          © {new Date().getFullYear()} Luca Tozzini
        </Typography>
      </Container>
    </>
  );
}

export default App;
