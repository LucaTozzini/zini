import {
  Typography,
  Stack,
  Card,
  CardActionArea,
  CardContent,
  Grid,
} from "@mui/material";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import InstagramIcon from "@mui/icons-material/Instagram";
import XIcon from "@mui/icons-material/X";
import EmailIcon from "@mui/icons-material/Email";
import LinkedInIcon from "@mui/icons-material/LinkedIn";
import GitHubIcon from "@mui/icons-material/GitHub";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";

const SOCIALS: {
  name: string;
  link: string;
  Icon: ComponentType<SvgIconProps>;
}[] = [
  {
    name: "LinkedIn",
    link: "https://www.linkedin.com/in/lucatozzini/",
    Icon: LinkedInIcon,
  },
  { name: "GitHub", link: "https://github.com/lucatozzini", Icon: GitHubIcon },
  {
    name: "Instagram",
    link: "https://www.instagram.com/luca_tozzini/",
    Icon: InstagramIcon,
  },
  { name: "Twitter/X", link: "https://x.com/tozzini_luca", Icon: XIcon },
  { name: "Email", link: "mailto:me@lucatozzini.com", Icon: EmailIcon },
  {
    name: "MySpace",
    link: "https://myspace.com/luca_tozzini",
    Icon: PeopleAltIcon,
  },
];

const Socials = () => {
  return (
    <section id="socials" style={{ scrollMarginTop: 100 }}>
      <Typography variant="h2" sx={{ mb: 6 }}>
        Socials
      </Typography>
      <Grid container spacing={2}>
        {SOCIALS.map(({ name, link, Icon }) => (
          <Grid key={name} size={{ xs: 6, md: 4 }}>
            <Card
              variant="outlined"
              sx={{
                height: "100%",
                transition: "transform 200ms ease, box-shadow 200ms ease",
                "&:hover": {
                  transform: "translateY(-4px)",
                  boxShadow: 1,
                  "& .MuiSvgIcon-root": { color: "secondary.main" },
                },
              }}
            >
              <CardActionArea
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ height: "100%" }}
              >
                <CardContent>
                  <Stack
                    spacing={1.5}
                    sx={{ py: 2, textAlign: "center", alignItems: "center" }}
                  >
                    <Icon
                      fontSize="large"
                      sx={{ transition: "color 200ms ease" }}
                    />
                    <Typography variant="h6" component="p">
                      {name}
                    </Typography>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </section>
  );
};

export default Socials;
