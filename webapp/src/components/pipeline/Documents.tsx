import { Alert, List, ListItem, Stack, Typography } from "@mui/material";
import type { ChecksDocument, Clarification, PlanDocument, QaDocument, ReviewDocument } from "shared";

// How the subagents' documents are shown in the timeline. blockingQuestions aren't
// shown here: they're asked in a QuestionsCard below the document. The coder's
// document is only questions; its work shows as the workspace's diff.

function Summary({ text }: { text: string }) {
  return <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{text}</Typography>;
}

// A numbered or bulleted list of plain-text items.
function Items({ items, numbered }: { items: string[]; numbered?: boolean }) {
  return (
    <List
      component={numbered ? "ol" : "ul"}
      dense
      disablePadding
      sx={{ pl: 3, listStyleType: numbered ? "decimal" : "disc" }}
    >
      {items.map((item, i) => (
        <ListItem key={i} disableGutters sx={{ display: "list-item", py: 0.25 }}>
          <Typography variant="body2">{item}</Typography>
        </ListItem>
      ))}
    </List>
  );
}

export function PlanView({ plan }: { plan: PlanDocument }) {
  return (
    <Stack spacing={1.5}>
      <Summary text={plan.summary} />
      <Typography variant="overline" color="text.secondary">
        Steps
      </Typography>
      <Items items={plan.steps} numbered />
      {!!plan.acceptanceCriteria?.length && <>
        <Typography variant="overline" color="text.secondary">Acceptance criteria</Typography>
        <Items items={plan.acceptanceCriteria.map((entry) => `${entry.id}: ${entry.requirement}`)} />
      </>}
    </Stack>
  );
}

// An empty requiredChanges means the review passed.
export function ReviewView({ review }: { review: ReviewDocument }) {
  return review.requiredChanges.length > 0 ? (
    <Alert severity="warning" variant="outlined">
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        Required changes
      </Typography>
      <Items items={review.requiredChanges} />
    </Alert>
  ) : (
    <Alert severity="success" variant="outlined">
      No changes required.
    </Alert>
  );
}

// The QA's report: the verdict with what's broken, then what it checked and what it
// couldn't.
export function QaView({ qa }: { qa: QaDocument }) {
  return (
    <Stack spacing={1.5}>
      {qa.verdict === "fail" ? (
        <Alert severity="error" variant="outlined">
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            Failures
          </Typography>
          <Items items={qa.failures} />
        </Alert>
      ) : qa.verdict === "partial" ? (
        <Alert severity="warning" variant="outlined">Validation is incomplete.</Alert>
      ) : (
        <Alert severity="success" variant="outlined">
          Passed.
        </Alert>
      )}
      {qa.couldNotTest.length > 0 && (
        <Alert severity="warning" variant="outlined">
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            Couldn't test
          </Typography>
          <Items items={qa.couldNotTest} />
        </Alert>
      )}
      {qa.checks.length > 0 && (
        <>
          <Typography variant="overline" color="text.secondary">
            Checks
          </Typography>
          <Items items={qa.checks} />
        </>
      )}
    </Stack>
  );
}

export function ChecksView({ checks }: { checks: ChecksDocument }) {
  return <Stack spacing={1.5}>
    {checks.results.map((result, index) => <Alert key={index}
      severity={result.status === "passed" ? "success" : result.status === "failed" ? "error" : "warning"}
      variant="outlined">
      <Typography variant="body2">{result.command} ({result.cwd}): {result.status}</Typography>
      <Typography component="pre" variant="body2" sx={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>{result.output}</Typography>
    </Alert>)}
    {!!checks.couldNotTest.length && <Alert severity="warning"><Items items={checks.couldNotTest} /></Alert>}
  </Stack>;
}

// The questions a stage asked and how you answered them, shown compactly above its
// latest document so it's clear why the document changed.
export function ClarificationList({ clarifications }: { clarifications: Clarification[] }) {
  if (clarifications.length === 0) return null;
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      <Typography variant="overline" color="text.secondary">
        Your answers
      </Typography>
      {clarifications.map((c, i) => (
        <Stack key={i} spacing={0.25}>
          <Typography variant="body2" color="text.secondary">
            {c.question}
          </Typography>
          <Typography variant="body2">{c.answer}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}
