import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createMiddleware, tool } from "langchain";
import { z } from "zod";
import { replaceOnce } from "../core/textEdit.js";
import { hasServedWiki } from "../openwiki/serving.js";
import { projectDir } from "../projects/projects.js";
import type { Repo } from "../repositories/git.js";

// The project lead's project notes: what it has learned that should shape every chat
// of the project, not just the one it learned it in. A markdown file in the project's
// folder in zini's data folder, which you can also read and edit yourself. It's read on
// every model call and put in the system prompt, so an edit, from any chat or by you,
// applies on the next call everywhere.

const notesPath = (repo: Repo) => join(projectDir(repo.id), "project-lead.md");

// Keeps the notes small enough to send on every call. Past it, edits that grow them are
// refused, so the agent condenses them instead.
const MAX_NOTES_CHARS = 8_000;

// A missing or empty file starts as this, so edit_notes always has text to anchor on.
// The repository overview is only for repos without an OpenWiki, which covers it.
const skeleton = (wiki: boolean) => `# Project notes
${wiki ? "" : "\n## Repository overview\n"}
## Preferences

## Conventions

## Decisions
`;

const OVERVIEW_PROMPT = `After exploring the repository, save or update a brief overview of what the product
does, its main components and their responsibilities, its stack, and useful entry
points. Summarizing verified code facts is encouraged: future chats should not need
to rediscover the basic project context. Only record what you have actually verified;
do not invent an overview or explore the whole repo just to fill the notes. The
overview is orientation, not authoritative implementation documentation.`;

const WIKI_PROMPT = `This repo has an OpenWiki: use openwiki_search and openwiki_read for what the
product does, its architecture and where things live. Don't keep a repository overview
or code summaries in these notes; when you next edit them, remove any that are there.`;

// Built per call: whether the repo has a wiki can change between calls.
const notesPrompt = (wiki: boolean) => `## Project notes

These notes are shared by all your chats and put in this prompt in every one. They
aren't in the repo; change them only with edit_notes, when you learn something that
should help future chats: ${wiki ? "" : "a concise repository overview, "}the user's preferences, the
project's conventions, decisions and why they were made.

${wiki ? WIKI_PROMPT : OVERVIEW_PROMPT}

Avoid copying source code, exhaustive file lists, full issue descriptions, temporary
issue/Forge status, and details that only matter to this chat. Check current code before
making claims or changes, and correct or remove notes when you discover they are stale.
Keep all notes short and focused.`;

// Sync, so reading, editing and writing the file can't interleave with another edit.
export function readNotes(repo: Repo) {
  const path = notesPath(repo);
  const notes = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (notes.trim()) return notes;
  const empty = skeleton(hasServedWiki(repo));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, empty);
  return empty;
}

const editNotes = (repo: Repo) =>
  tool(
    ({ oldText, newText }) => {
      const notes = readNotes(repo);
      const edited = replaceOnce(notes, oldText, newText, "the notes");
      if (edited.length > MAX_NOTES_CHARS && edited.length > notes.length) {
        throw new Error(
          `The notes would be ${edited.length} characters, over the ${MAX_NOTES_CHARS} limit. ` +
            "Condense or remove notes first.",
        );
      }
      writeFileSync(notesPath(repo), edited);
      return "Edited the notes";
    },
    {
      name: "edit_notes",
      description:
        "Save shared project knowledge for future Project Lead chats: preferences, conventions, and " +
        "decisions with their rationale, plus a concise verified repo overview only when the repo has no " +
        "OpenWiki. Copied source, detailed inventories and temporary issue status don't belong here. " +
        "Correct stale notes as you learn more. Replace oldText with newText. oldText must appear exactly once: " +
        "copy it from the notes in your prompt. To add a note, use a nearby line as oldText " +
        "(e.g. its section's heading) and repeat it in newText with the note added.",
      schema: z.object({
        oldText: z
          .string()
          .min(1)
          .describe("Exact text occurring once in the current notes; include a nearby heading when adding a section or note."),
        newText: z
          .string()
          .describe("Replacement Markdown. Keep verified project context concise; an empty string removes the matched text."),
      }),
    },
  );

export const notesMiddleware = (repo: Repo) =>
  createMiddleware({
    name: "Notes",
    tools: [editNotes(repo)],
    wrapModelCall: (request, handler) =>
      handler({
        ...request,
        systemMessage: request.systemMessage.concat(`\n\n${notesPrompt(hasServedWiki(repo))}\n\n${readNotes(repo)}`),
      }),
  });
