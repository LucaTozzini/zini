import { Avatar, Button, Stack, Typography } from "@mui/material";
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineItem,
  TimelineSeparator,
} from "@mui/lab";
import ArticleIcon from "@mui/icons-material/Article";

const Item = ({
  company,
  logo,
  position,
  location,
  date,
  isLast,
}: {
  company: string;
  logo: string;
  position: string;
  location: string;
  date: string;
  isLast: boolean;
}) => (
  <TimelineItem>
    <TimelineSeparator>
      <Avatar
        variant="rounded"
        src={logo}
        alt={`${company} logo`}
        sx={{ width: 44, height: 44 }}
      />
      {!isLast && <TimelineConnector />}
    </TimelineSeparator>
    <TimelineContent sx={{ pb: 5 }}>
      <Typography variant="caption" color="text.secondary">
        {date}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        {company}
      </Typography>
      <Typography variant="subtitle1">{position}</Typography>
      <Typography variant="body2" color="text.secondary">
        {location}
      </Typography>
    </TimelineContent>
  </TimelineItem>
);

const Experience = () => {
  return (
    <section id="experience" style={{ scrollMarginTop: 100 }}>
      <Typography variant="h2" gutterBottom>
        Experience
      </Typography>

      <Stack direction={"row"} spacing={1} sx={{ mb: 4 }}>
        <Button
          component={"a"}
          target="_blank"
          rel="noopener noreferrer"
          href="/Luca Tozzini - Resume.pdf"
          variant="contained"
          startIcon={<ArticleIcon />}
        >
          View my resume
        </Button>
      </Stack>

      <Timeline
        sx={{
          p: 0,
          m: 0,
          // Collapse MUI's default opposite-content spacer so the rail sits flush left.
          '&& .MuiTimelineItem-root::before': { display: 'none' },
        }}
      >
        <Item
          company="RenoFiz"
          logo="https://www.renofiz.com/api/assets/logo.png"
          position="Co-founder & Full-Stack Developer"
          location="Vancouver, BC, Canada"
          date={"2025 — Present"}
          isLast={false}
        />
        <Item
          company="Solaires"
          logo="https://www.solaires.net/static/img/header/solaires.png"
          position="Co-op Full-Stack Developer"
          location="Victoria, BC, Canada"
          date={"Jan 2025 — Aug 2025"}
          isLast={false}
        />
        <Item
          company="DataAnnotation"
          logo="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQZR4_cE_TBxwvSHE3nKV6EBtIkxhbVNM5szkfKYoG4sQeVPr7QesaTG-ZJ&s=10"
          location="Remote"
          position="AI Quality Assurance (freelance)"
          date="Jul 2024 — Dec 2024"
          isLast={true}
        />
      </Timeline>
    </section>
  );
};

export default Experience;
