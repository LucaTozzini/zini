import { createSvgIcon } from "@mui/material/utils";

// Single-color vector of Papertrail's mark (the SolarWinds bird, from its logo), scaled
// into the 24px box; inherits MUI's currentColor.
const PapertrailIcon = createSvgIcon(
  <g transform="translate(-9.775 -9.12) scale(0.21463)">
    <path d="M88.3,102.8c4.4,4.5,8,9.8,10.8,15.5,17.3-9.6,41.2-21.9,53.6-23.6,0,0-31.6-2.4-64.4,8.2Z" />
    <path d="M99.9,95.6c6.6-1.9,13-4.4,19.3-7.1,6.2-2.6,12.4-5.7,17.8-10.1,5.5-4.5,10-10.4,12.5-17.6.3-1,1.1-2.5,1.1-3.6-8.6,11.8-42.9,13-42.9,13l8.1-7.4c-32.5,0-55.2,13.9-65.5,21.2,13.3,1.4,25.3,7.1,34.7,15.5,4.6-1.4,9.4-2.5,14-3.8.3,0,.6-.2.9-.2Z" />
    <path d="M105.2,139.6l30.1-30.9-34,14.6c2,5.2,3.3,10.6,3.9,16.3Z" />
  </g>,
  "Papertrail",
);

export default PapertrailIcon;
