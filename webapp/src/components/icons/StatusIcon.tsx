import { useId } from "react";
import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import type { StatusType } from "shared";

// A filled circle with a mark cut out of it, e.g. the check for completed.
function CutOutCircle({ mark }: { mark: string }) {
  const id = useId();
  return (
    <>
      <mask id={id}>
        <rect width={16} height={16} fill="white" />
        <path
          d={mark}
          fill="none"
          stroke="black"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
      <circle cx={8} cy={8} r={7} mask={`url(#${id})`} />
    </>
  );
}

// Linear's status icons, one per status type, so they work whatever a workspace
// calls its statuses. The status's own name is the icon's accessible title.
function StatusIcon({ type, name, ...props }: { type: StatusType; name: string } & SvgIconProps) {
  return (
    <SvgIcon viewBox="0 0 16 16" titleAccess={name} {...props}>
      {type === "backlog" && (
        <circle cx={8} cy={8} r={6} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="2.3 1.6" />
      )}
      {type === "unstarted" && (
        <circle cx={8} cy={8} r={6} fill="none" stroke="currentColor" strokeWidth={1.5} />
      )}
      {type === "started" && (
        <>
          <circle cx={8} cy={8} r={6} fill="none" stroke="currentColor" strokeWidth={1.5} />
          <path d="M8 4a4 4 0 0 1 0 8Z" />
        </>
      )}
      {type === "completed" && <CutOutCircle mark="M5 8.2l2 2 4-4.4" />}
      {(type === "canceled" || type === "duplicate") && <CutOutCircle mark="M5.5 5.5l5 5M10.5 5.5l-5 5" />}
      {type === "triage" && <CutOutCircle mark="M4.5 6.5h7l-2-2M11.5 9.5h-7l2 2" />}
    </SvgIcon>
  );
}

export default StatusIcon;
