import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createMiddleware, tool } from "langchain";
import { z } from "zod";
import { storage } from "./db.js";
import { replaceOnce } from "./textEdit.js";

// The product manager's project notes: what it has learned that should shape every chat,
// not just the one it learned it in. A markdown file in zini's data folder, which you
// can also read and edit yourself. It's read on every model call and put in the system
// prompt, so an edit, from any chat or by you, applies on the next call everywhere.

const NOTES_PATH = resolve(dirname(storage), "agents", "pm.md");

// Keeps the notes small enough to send on every call. Past it, edits that grow them are
// refused, so the agent condenses them instead.
const MAX_NOTES_CHARS = 8_000;

// A missing or empty file starts as this, so edit_notes always has text to anchor on.
const SKELETON = `# Project notes

## Preferences

## Conventions

## Decisions
`;

const NOTES_PROMPT = `## Project notes

These notes are shared by all your chats and put in this prompt in every one. They
aren't in the repo; change them only with edit_notes, when you learn something that
should shape future chats: the user's preferences, the project's conventions, decisions
and why they were made. Leave out what the code or Linear already says, and what only matters to this
chat (that goes in write_facts). Remove or correct notes that are no longer true, and
keep them short.`;

// Sync, so reading, editing and writing the file can't interleave with another edit.
export function readNotes() {
  const notes = existsSync(NOTES_PATH) ? readFileSync(NOTES_PATH, "utf8") : "";
  if (notes.trim()) return notes;
  mkdirSync(dirname(NOTES_PATH), { recursive: true });
  writeFileSync(NOTES_PATH, SKELETON);
  return SKELETON;
}

const editNotes = tool(
  ({ oldText, newText }) => {
    const notes = readNotes();
    const edited = replaceOnce(notes, oldText, newText, "the notes");
    if (edited.length > MAX_NOTES_CHARS && edited.length > notes.length) {
      throw new Error(
        `The notes would be ${edited.length} characters, over the ${MAX_NOTES_CHARS} limit. ` +
          "Condense or remove notes first.",
      );
    }
    writeFileSync(NOTES_PATH, edited);
    return "Edited the notes";
  },
  {
    name: "edit_notes",
    description:
      "Replace oldText with newText in the project notes. oldText must appear exactly once: " +
      "copy it from the notes in your prompt. To add a note, use a nearby line as oldText " +
      "(e.g. its section's heading) and repeat it in newText with the note added.",
    schema: z.object({ oldText: z.string().min(1), newText: z.string() }),
  },
);

export const notesMiddleware = createMiddleware({
  name: "Notes",
  tools: [editNotes],
  wrapModelCall: (request, handler) =>
    handler({
      ...request,
      systemMessage: request.systemMessage.concat(`\n\n${NOTES_PROMPT}\n\n${readNotes()}`),
    }),
});
