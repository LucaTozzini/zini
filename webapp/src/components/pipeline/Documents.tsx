import { List, ListItem, Stack, Typography } from "@mui/material";
import type { ForgePlan } from "shared";

// The Lead's plan: its steps and QA checklist, each with its status (and a check's
// note on why it failed or was skipped).
export function PlanView({ plan }: { plan: ForgePlan }) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="overline" color="text.secondary">Steps</Typography>
      {plan.steps.length === 0
        ? <Typography variant="body2" color="text.secondary">No implementation steps.</Typography>
        : <Items items={plan.steps.map((step) => `${step.id} [${step.status}] ${step.description}`)} />}
      <Typography variant="overline" color="text.secondary">QA checklist</Typography>
      <Items items={plan.qaChecklist.map((check) =>
        `${check.id} [${check.status}] ${check.condition}${check.note ? ` — ${check.note}` : ""}`)} />
    </Stack>
  );
}

function Items({ items }: { items: string[] }) {
  return (
    <List component="ul" dense disablePadding sx={{ pl: 3, listStyleType: "disc" }}>
      {items.map((item, i) => (
        <ListItem key={i} disableGutters sx={{ display: "list-item", py: 0.25 }}>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{item}</Typography>
        </ListItem>
      ))}
    </List>
  );
}
