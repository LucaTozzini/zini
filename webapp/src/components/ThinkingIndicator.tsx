import { useTheme } from "@mui/material";
import { ScaleLoader } from "react-spinners";

<ScaleLoader color="#36d7b7" />;
export default function ThinkingIndicator() {
  const theme = useTheme();
  return (
    <ScaleLoader
      barCount={4}
      margin={1.5}
      radius={0}
      height={20}
      width={3}
      color={(theme.vars || theme).palette.text.secondary}
    />
  );
}
