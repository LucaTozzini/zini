import { auth, drive as driveApi, type drive_v3 } from "@googleapis/drive";

// Read-only access to Google Drive as a service account: it sees only the files, folders
// and shared drives shared with its email, and the key is saved as its whole JSON file.

export const MAX_FILES = 50;
// A read returns this many characters of a file at most; the rest is read from an offset.
export const MAX_CHARS = 40000;
// A Doc's images sent with one read at most; the rest are left as their markers.
export const MAX_IMAGES = 10;
// PDFs and images go to the model whole, so bigger ones are refused.
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const FOLDER = "application/vnd.google-apps.folder";
// Google's own formats can't be downloaded, only exported: as these.
const EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/markdown",
  // Only the first sheet: Drive exports one sheet as CSV.
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

type ServiceAccountKey = { client_email: string; private_key: string };

// The key's JSON, checked to be a service account's, with what's wrong if it isn't.
function parseKey(key: string): ServiceAccountKey {
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

function client(key: string) {
  return driveApi({
    version: "v3",
    auth: new auth.GoogleAuth({
      credentials: parseKey(key),
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    }),
  });
}

// The service account's email: what to share files with, and how a connected key is shown.
export function googleDriveHint(key: string) {
  try {
    return parseKey(key).client_email;
  } catch {
    return "a service account";
  }
}

// true if Google accepts the key, false if it rejects it (a deleted or disabled key).
// Other failures throw with what went wrong, e.g. the Drive API not enabled in its project.
export async function testGoogleDriveKey(key: string) {
  // Outside the try, so a key that isn't one says so as it is.
  const drive = client(key);
  try {
    await drive.files.list({ pageSize: 1, fields: "files(id)" });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/invalid_grant|invalid_client|unauthorized_client/i.test(message)) return false;
    throw new Error(`Couldn't reach Google Drive: ${message}`);
  }
}

const quote = (text: string) => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

// Files shared with the service account: those whose name or text match query, those in a
// folder (a shared drive's id lists its top level), or both. With neither, the top level:
// the shared drives it's a member of, then the folders and files shared with it directly.
export async function searchDrive(key: string, { query, folderId }: { query?: string; folderId?: string }) {
  const drive = client(key);
  const topLevel = !query && !folderId;
  const filters = ["trashed = false"];
  if (query) filters.push(`(name contains ${quote(query)} or fullText contains ${quote(query)})`);
  if (folderId) filters.push(`${quote(folderId)} in parents`);
  if (topLevel) filters.push("sharedWithMe = true");
  const [{ data }, drives] = await Promise.all([
    drive.files.list({
      q: filters.join(" and "),
      pageSize: MAX_FILES,
      // Drive can't order a full-text search: it ranks those by relevance.
      orderBy: query ? undefined : "folder, name",
      corpora: "allDrives",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)",
    }),
    topLevel ? drive.drives.list({ pageSize: 100, fields: "drives(id, name)" }) : null,
  ]);
  return {
    files: [
      ...(drives?.data.drives ?? []).map((sharedDrive) => ({
        id: sharedDrive.id,
        name: sharedDrive.name,
        type: "shared drive",
      })),
      ...(data.files ?? []).map((file) => ({
        id: file.id,
        name: file.name,
        type: file.mimeType === FOLDER ? "folder" : file.mimeType,
        modified: file.modifiedTime,
        link: file.webViewLink,
      })),
    ],
    truncated: Boolean(data.nextPageToken),
  };
}

// A Doc's Markdown export has its images inline as base64 data URLs, which the model
// can't see and which cost a lot of tokens. Each becomes an "[image N]" marker, and the
// images are returned beside the text. Drive writes them as references, ![][image1] with
// [image1]: <data:...> at the end, but inline ![alt](data:...) is handled too.
export function extractDocImages(markdown: string) {
  const references = new Map<string, string>();
  const withoutReferences = markdown.replace(
    /^\[([^\]]+)\]:\s*<?(data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)>?[ \t]*\n?/gm,
    (_, label: string, url: string) => {
      references.set(label, url);
      return "";
    },
  );
  // Both kinds in one pass, so images are numbered in the order they appear.
  const images: string[] = [];
  const text = withoutReferences.replace(
    /!\[([^\]]*)\](?:\[([^\]]+)\]|\(<?(data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)>?\))/g,
    (match, alt: string, label: string | undefined, inline: string | undefined) => {
      const url = inline ?? (label && references.get(label));
      if (!url) return match;
      images.push(url);
      return `[image ${images.length}${alt ? `: ${alt}` : ""}]`;
    },
  );
  return { text: text.trimEnd(), images };
}

const download = async (drive: drive_v3.Drive, fileId: string) =>
  Buffer.from(
    (await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" }))
      .data as unknown as ArrayBuffer,
  );

type DriveFileInfo = { name: string; type: string; modified?: string; link?: string };
export type DriveFile =
  | { kind: "file"; info: DriveFileInfo; bytes: Buffer }
  | {
      kind: "text";
      info: DriveFileInfo & { length: number; nextOffset?: number };
      text: string;
      // The images whose markers are in text, by number.
      images: { number: number; url: string }[];
    };

// A file for the model to read. PDFs and images are returned whole, to be given to it as
// themselves. The rest is text, from offset, up to MAX_CHARS: Docs as Markdown with their
// images beside it, Sheets as CSV, Slides and text files as plain text. nextOffset is
// where to read on from, if there's more.
export async function readDriveFile(key: string, fileId: string, offset = 0): Promise<DriveFile> {
  const drive = client(key);
  const { data: file } = await drive.files.get({
    fileId,
    supportsAllDrives: true,
    fields: "id, name, mimeType, size, modifiedTime, webViewLink",
  });
  const type = file.mimeType ?? "";
  const info = {
    name: file.name ?? fileId,
    type,
    modified: file.modifiedTime ?? undefined,
    link: file.webViewLink ?? undefined,
  };

  if (type === "application/pdf" || type.startsWith("image/")) {
    if (Number(file.size) > MAX_FILE_BYTES)
      throw new Error(`${info.name} is ${Math.round(Number(file.size) / 1024 / 1024)} MB, over the 20 MB that can be read.`);
    return { kind: "file", info, bytes: await download(drive, fileId) };
  }

  let text: string;
  let images: string[] = [];
  const exportAs = EXPORTS[type];
  if (exportAs) {
    const { data } = await drive.files.export({ fileId, mimeType: exportAs }, { responseType: "text" });
    ({ text, images } = exportAs === "text/markdown" ? extractDocImages(String(data)) : { text: String(data), images });
  } else if (type.startsWith("text/") || type === "application/json") {
    const { data } = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
    text = String(data);
  } else if (type === FOLDER) {
    throw new Error(`${info.name} is a folder: search it with its id as folderId instead.`);
  } else {
    throw new Error(`${info.name} is a ${type} file, which can't be read.`);
  }

  const end = offset + MAX_CHARS;
  const slice = text.slice(offset, end);
  return {
    kind: "text",
    info: { ...info, length: text.length, ...(end < text.length && { nextOffset: end }) },
    text: slice,
    images: images
      .map((url, i) => ({ number: i + 1, url }))
      .filter(({ number }) => slice.includes(`[image ${number}]`) || slice.includes(`[image ${number}: `)),
  };
}
