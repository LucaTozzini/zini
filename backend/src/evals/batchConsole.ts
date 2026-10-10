import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";

export const CONSOLE_TAIL_LINES = 500;

// Read a bounded tail even when a batch has produced a very large log.
export function readConsoleTail(file: string): string[] {
  if (!existsSync(file)) return [];
  const size = statSync(file).size;
  const start = Math.max(0, size - 256 * 1024);
  const buffer = Buffer.alloc(size - start);
  const fd = openSync(file, "r");
  let bytes: number;
  try { bytes = readSync(fd, buffer, 0, buffer.length, start); }
  finally { closeSync(fd); }
  let content = buffer.subarray(0, bytes).toString("utf8");
  if (start > 0) {
    const newline = content.indexOf("\n");
    if (newline === -1) return [];
    content = content.slice(newline + 1);
  }
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-CONSOLE_TAIL_LINES);
}

export class BatchConsole {
  readonly tail: string[];
  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, "");
    this.tail = readConsoleTail(file);
  }

  append(line: string) {
    // Persist first; the UI buffer is only a convenience for live updates.
    appendFileSync(this.file, `${line}\n`);
    this.tail.push(...line.split("\n"));
    if (this.tail.length > CONSOLE_TAIL_LINES) this.tail.splice(0, this.tail.length - CONSOLE_TAIL_LINES);
  }
}

// Each stream needs its own decoder and partial line: stdout and stderr can interleave.
export function followConsole(stream: Readable, onLine: (line: string) => void) {
  const decoder = new StringDecoder("utf8");
  let partial = "";
  const read = (text: string) => {
    const lines = (partial + text).split(/\r?\n/);
    partial = lines.pop() ?? "";
    lines.forEach(onLine);
  };
  stream.on("data", (chunk: Buffer) => read(decoder.write(chunk)));
  stream.on("end", () => { read(decoder.end()); if (partial) onLine(partial); });
}
