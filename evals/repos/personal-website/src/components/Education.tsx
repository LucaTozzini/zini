import { Typography } from "@mui/material";
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineItem,
  TimelineSeparator,
} from "@mui/lab";
import SchoolIcon from "@mui/icons-material/School";

const Item = ({
  school,
  location,
  field,
  startYear,
  endYear,
  isLast,
}: {
  school: string;
  location: string;
  field: string;
  startYear: number;
  endYear: number;
  isLast: boolean;
}) => (
  <TimelineItem>
    <TimelineSeparator>
      <TimelineDot color="secondary">
        <SchoolIcon fontSize="small" />
      </TimelineDot>
      {!isLast && <TimelineConnector />}
    </TimelineSeparator>
    <TimelineContent sx={{ pb: 5 }}>
      <Typography variant="caption" color="text.secondary">
        {startYear} — {endYear}
      </Typography>
      <Typography variant="h5" sx={{ color: "secondary.dark", fontWeight: 600 }}>
        {school}
      </Typography>
      <Typography variant="subtitle1">{field}</Typography>
      <Typography variant="body2" color="text.secondary">
        {location}
      </Typography>
    </TimelineContent>
  </TimelineItem>
);

const Education = () => {
  return (
    <section id="education" style={{ scrollMarginTop: 100 }}>
      <Typography variant="h2" gutterBottom>
        Education
      </Typography>
      <Timeline
        sx={{
          p: 0,
          m: 0,
          // Collapse MUI's default opposite-content spacer so the rail sits flush left.
          '&& .MuiTimelineItem-root::before': { display: 'none' },
        }}
      >
        <Item
          school="University of Victoria"
          location="Victoria, BC, Canada"
          field="Bachelor of Science, Computer Science Major"
          startYear={2021}
          endYear={2026}
          isLast={false}
        />
        <Item
          school="Templeton Secondary School"
          location="Vancouver, BC, Canada"
          field="STEM program"
          startYear={2015}
          endYear={2020}
          isLast={true}
        />
      </Timeline>
    </section>
  );
};

export default Education;
