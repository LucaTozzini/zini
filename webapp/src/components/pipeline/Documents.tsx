import type { ReactNode } from "react";
import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DoNotDisturbOnOutlinedIcon from "@mui/icons-material/DoNotDisturbOnOutlined";
import PendingIcon from "@mui/icons-material/Pending";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { Box, Divider, Stack, Tooltip, Typography } from "@mui/material";
import type { ForgePlan, PlanStep, QaCheck } from "shared";

const statusIcons: Record<PlanStep["status"] | QaCheck["status"], { icon: ReactNode; label: string }> = {
  todo: { icon: <RadioButtonUncheckedIcon fontSize="small" color="disabled" />, label: "To do" },
  "in-progress": { icon: <PendingIcon fontSize="small" color="info" />, label: "In progress" },
  complete: { icon: <CheckCircleIcon fontSize="small" color="success" />, label: "Complete" },
  passed: { icon: <CheckCircleIcon fontSize="small" color="success" />, label: "Passed" },
  failed: { icon: <CancelIcon fontSize="small" color="error" />, label: "Failed" },
  skipped: { icon: <DoNotDisturbOnOutlinedIcon fontSize="small" color="warning" />, label: "Skipped" },
};

// Splits a description into its first sentence (the row's title) and the rest.
function split(text: string) {
  const match = /^(.+?[.!?])\s+(.+)$/s.exec(text.trim());
  return match ? { title: match[1], detail: match[2] } : { title: text.trim(), detail: "" };
}

function Row({ id, status, text, note }: { id: string; status: keyof typeof statusIcons; text: string; note?: string }) {
  const { title, detail } = split(text);
  const { icon, label } = statusIcons[status];
  return (
    <Stack direction="row" spacing={1.5} sx={{ py: 1 }}>
      <Tooltip title={label}>
        <Box sx={{ pt: 0.25, display: "flex" }}>{icon}</Box>
      </Tooltip>
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          <Box component="span" sx={{ color: "text.secondary", mr: 1 }}>
            {id}
          </Box>
          {title}
        </Typography>
        {detail && (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
            {detail}
          </Typography>
        )}
        {note && (
          <Typography variant="body2" color={status === "failed" ? "error" : "warning.main"}>
            {note}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

function Section({ title, done, total, children }: { title: string; done: number; total: number; children: ReactNode }) {
  return (
    <Stack>
      <Typography variant="overline" color="text.secondary">
        {title}
        {total ? ` · ${done} of ${total}` : ""}
      </Typography>
      <Stack divider={<Divider flexItem />}>{children}</Stack>
    </Stack>
  );
}

// The Lead's plan: its steps and QA checklist, each with its status (and a check's
// note on why it failed or was skipped).
export function PlanView({ plan }: { plan: ForgePlan }) {
  return (
    <Stack spacing={3}>
      <Section title="Steps" done={plan.steps.filter((step) => step.status === "complete").length} total={plan.steps.length}>
        {plan.steps.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            No implementation steps.
          </Typography>
        ) : (
          plan.steps.map((step) => <Row key={step.id} id={step.id} status={step.status} text={step.description} />)
        )}
      </Section>
      <Section
        title="QA checklist"
        done={plan.qaChecklist.filter((check) => check.status === "passed").length}
        total={plan.qaChecklist.length}
      >
        {plan.qaChecklist.map((check) => (
          <Row key={check.id} id={check.id} status={check.status} text={check.condition} note={check.note || undefined} />
        ))}
      </Section>
    </Stack>
  );
}
