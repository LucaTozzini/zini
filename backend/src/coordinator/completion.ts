import { isModelRateLimit } from "../modelErrors.js";

// Retry submission with the existing evidence, without rerunning the role's work.
export async function completeDocument<T>(
  initial: { structuredResponse?: T },
  recover: (attempt: number) => Promise<{ structuredResponse?: T }>,
): Promise<T> {
  if (initial.structuredResponse) return initial.structuredResponse;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await recover(attempt);
      if (result.structuredResponse) return result.structuredResponse;
    } catch (error) {
      if (isModelRateLimit(error) || attempt === 2) throw error;
    }
  }
  throw new Error("The subagent finished without returning its document after two submission attempts");
}
