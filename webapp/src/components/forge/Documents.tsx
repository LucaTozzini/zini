import type { ReactNode } from "react";
import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DoNotDisturbOnOutlinedIcon from "@mui/icons-material/DoNotDisturbOnOutlined";
import PendingIcon from "@mui/icons-material/Pending";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { Box, Button, Divider, Stack, Tooltip, Typography } from "@mui/material";
import type { ForgePlan, PlanStep, QaCheck } from "shared";
import MarkdownText from "../MarkdownText.tsx";

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

// The Lead's plan: its design and mockups, then its steps and QA checklist, each with
// its status (and a check's note on why it failed or was skipped). Mockups are the
// Lead's HTML, so each is shown sandboxed, without scripts. With onCommentMockup, each
// mockup can be commented on, as its text can't be selected from outside its frame.
export function PlanView({
  plan,
  onCommentMockup,
}: {
  plan: ForgePlan;
  onCommentMockup?: (title: string, button: HTMLElement) => void;
}) {
  return (
    <Stack spacing={3}>
      <Stack>
        <Typography variant="overline" color="text.secondary">
          Design
        </Typography>
        <MarkdownText variant="body2">{plan.design}</MarkdownText>
      </Stack>
      {plan.mockups.length > 0 && (
        <Stack spacing={2}>
          <Typography variant="overline" color="text.secondary">
            Mockups
          </Typography>
          {plan.mockups.map((mockup) => (
            <Stack key={mockup.title} spacing={1}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
                  {mockup.title}
                </Typography>
                {onCommentMockup && (
                  <Button size="small" onClick={(e) => onCommentMockup(mockup.title, e.currentTarget)}>
                    Comment
                  </Button>
                )}
              </Stack>
              <Box
                component="iframe"
                title={mockup.title}
                sandbox=""
                srcDoc={mockup.html}
                sx={{ width: "100%", height: 420, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#fff" }}
              />
            </Stack>
          ))}
        </Stack>
      )}
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
