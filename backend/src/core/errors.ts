// What went wrong, as text: an Error's message, or anything else thrown as a string.
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
