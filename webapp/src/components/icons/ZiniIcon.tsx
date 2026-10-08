import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import { useId } from "react";

export default function ZiniIcon(props: SvgIconProps) {
  const id = useId();
  const background = "var(--mui-palette-background-default, #141414)";
  return (
    <SvgIcon viewBox="0 0 24 24" titleAccess="Zini" {...props}>
      <defs>
        <clipPath id={`${id}-outline`}>
          <rect x="2.5" y="2.5" width="19" height="19" rx="3" />
        </clipPath>
        <linearGradient id={`${id}-base`} x1="12" y1="2.5" x2="12" y2="21.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0.5" />
          <stop offset="0.22" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="0.75" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.07" />
        </linearGradient>
        <radialGradient id={`${id}-shine`} cx="20.5" cy="3" r="4.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0.7" />
          <stop offset="0.5" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-side`} x1="2.5" y1="12" x2="6" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor={background} stopOpacity="0.9" />
          <stop offset="1" stopColor={background} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-face`} x1="17" y1="5" x2="7" y2="19" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0.005" />
          <stop offset="0.45" stopColor="currentColor" stopOpacity="0.035" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.14" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}-outline)`}>
        <rect x="2.5" y="2.5" width="19" height="19" fill={background} />
        <rect x="2.5" y="2.5" width="19" height="19" fill={`url(#${id}-base)`} />
        <rect x="2.5" y="2.5" width="19" height="19" fill={`url(#${id}-shine)`} />
        <path d="M2.5 2.5 6 6v12l-3.5 3.5Z" fill={`url(#${id}-side)`} />
      </g>
      <rect x="4.75" y="4.75" width="14.5" height="14.5" rx="1.25" fill={background} />
      <rect x="4.75" y="4.75" width="14.5" height="14.5" rx="1.25" fill={`url(#${id}-face)`} />
      <path d="M8.5 8h7l-7 8h7" transform="translate(12 12) scale(0.85) translate(-12 -12)" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="square" />
    </SvgIcon>
  );
}
