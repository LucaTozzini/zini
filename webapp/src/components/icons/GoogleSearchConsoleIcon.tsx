import { createSvgIcon } from "@mui/material/utils";

// Single-color vector of the Google Search Console logo (from Google's own SVG), scaled into
// the 24px box; inherits MUI's currentColor. The logo's shapes overlap in color, so each is
// cut back a little where the one in front of it covers it, to keep them apart in one color.
const GoogleSearchConsoleIcon = createSvgIcon(
  <>
    <defs>
      <mask id="google-search-console-back-bar" maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="40">
        <rect width="40" height="40" fill="#fff" />
        <path
          d="M27.97 32.5h-5.887a6.04 6.04 0 0 1-6.041-6.042v-7.916a6.04 6.04 0 0 1 6.041-6.042 6.04 6.04 0 0 1 6.042 6.042v13.804a.154.154 0 0 1-.154.154z"
          stroke="#000"
          strokeWidth="3"
        />
      </mask>
      <mask id="google-search-console-front-bar" maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="40">
        <rect width="40" height="40" fill="#fff" />
        <path
          d="M13.75 32.5a6.04 6.04 0 0 0 6.042-6.042 6.04 6.04 0 0 0-6.042-6.041 6.04 6.04 0 0 0-6.042 6.041A6.04 6.04 0 0 0 13.75 32.5z"
          stroke="#000"
          strokeWidth="3"
        />
      </mask>
    </defs>
    <g transform="translate(-0.85 -0.66) scale(0.638)">
      <path
        d="M23.75 32.5h6.042a6.04 6.04 0 0 0 6.041-6.042v-16.25a6.04 6.04 0 0 0-6.041-6.041 6.04 6.04 0 0 0-6.042 6.041V32.5z"
        mask="url(#google-search-console-back-bar)"
      />
      <path
        d="M27.97 32.5h-5.887a6.04 6.04 0 0 1-6.041-6.042v-7.916a6.04 6.04 0 0 1 6.041-6.042 6.04 6.04 0 0 1 6.042 6.042v13.804a.154.154 0 0 1-.154.154z"
        mask="url(#google-search-console-front-bar)"
      />
      <path d="M13.75 32.5a6.04 6.04 0 0 0 6.042-6.042 6.04 6.04 0 0 0-6.042-6.041 6.04 6.04 0 0 0-6.042 6.041A6.04 6.04 0 0 0 13.75 32.5z" />
      <path d="M11.081 30.527l-4.72 4.721a.933.933 0 0 1-1.317 0l-.292-.292a.933.933 0 0 1 0-1.316l4.72-4.721a.933.933 0 0 1 1.318 0l.291.291a.93.93 0 0 1 0 1.317z" />
    </g>
  </>,
  "GoogleSearchConsole",
);

export default GoogleSearchConsoleIcon;
