import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import { PRIORITY_NAMES } from "shared";

// Bar heights for high, medium and low: three bars, with the ones above the
// priority faded out.
const BARS = [6, 9, 12];
const FILLED_BARS: Record<number, number> = { 2: 3, 3: 2, 4: 1 };

// Linear's priority icons: dashes for none, an exclamation box for urgent, and
// signal bars for high, medium and low. The name is the icon's accessible title.
function PriorityIcon({ priority, ...props }: { priority: number } & SvgIconProps) {
  const title = PRIORITY_NAMES[priority] ?? `Priority ${priority}`;

  return (
    <SvgIcon viewBox="0 0 16 16" titleAccess={title} {...props}>
      {priority === 0 &&
        [1.5, 6.5, 11.5].map((x) => <rect key={x} x={x} y={7.25} width={3} height={1.5} rx={0.75} />)}

      {priority === 1 && (
        // A rounded square with the exclamation mark cut out of it.
        <path
          fillRule="evenodd"
          d="M4 1h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3ZM7 3.5h2v5.5H7ZM7 10.5h2v2H7Z"
        />
      )}

      {priority >= 2 &&
        BARS.map((height, i) => (
          <rect
            key={height}
            x={1.5 + i * 5}
            y={14 - height}
            width={3}
            height={height}
            rx={1}
            opacity={i < (FILLED_BARS[priority] ?? 0) ? 1 : 0.35}
          />
        ))}
    </SvgIcon>
  );
}

export default PriorityIcon;
