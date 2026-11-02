// A Google service account's key, as Google Drive and Google Search Console connect with
// it: saved as its whole JSON file.

export type ServiceAccountKey = { client_email: string; private_key: string };

// The key's JSON, checked to be a service account's, with what's wrong if it isn't.
export function parseServiceAccountKey(key: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    throw new Error("That isn't a service account key: paste the whole JSON file you downloaded.");
  }
  const { type, client_email, private_key } = (parsed ?? {}) as Record<string, unknown>;
  if (type !== "service_account" || typeof client_email !== "string" || typeof private_key !== "string")
    throw new Error("That JSON isn't a service account key: create a key for a service account and paste its JSON file.");
  return { client_email, private_key };
}

// The service account's email: what to share with, and how a connected key is shown.
export function serviceAccountEmail(key: string) {
  try {
    return parseServiceAccountKey(key).client_email;
  } catch {
    return "a service account";
  }
}

// Whether Google rejected the key itself (a deleted or disabled key), from its error.
export const isRejectedKey = (message: string) => /invalid_grant|invalid_client|unauthorized_client/i.test(message);
