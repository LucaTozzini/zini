import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import { isIssueId } from "../workspaces/workspaces.js";

// For router.param("issueId"): a request whose :issueId isn't a Linear issue id gets a
// 400 and never reaches its handler.
export function checkIssueId(_req: Request, res: Response, next: NextFunction, value: string) {
  if (isIssueId(value)) next();
  else res.status(400).json({ error: "Expected a Linear issue id" });
}

// value (a request's body or query) parsed with schema, or null after sending a 400:
// error if given, otherwise the first problem the schema found.
export function parse<T>(schema: z.ZodType<T>, value: unknown, res: Response, error?: string): T | null {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  res.status(400).json({ error: error ?? result.error.issues[0]?.message ?? "Invalid request" });
  return null;
}
