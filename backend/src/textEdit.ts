// Replaces the one place oldText appears in content (a file named name, for the
// errors) with newText. Throws, telling the model what to do instead, if oldText is
// empty, missing or appears more than once. Matches a file's Windows line endings.
export function replaceOnce(content: string, oldText: string, newText: string, name: string) {
  if (!oldText) throw new Error("oldText can't be empty; copy the text to replace from the file");
  if (content.includes("\r\n")) {
    oldText = oldText.replace(/\r?\n/g, "\r\n");
    newText = newText.replace(/\r?\n/g, "\r\n");
  }
  const count = content.split(oldText).length - 1;
  if (count === 0) throw new Error(`oldText isn't in ${name}; read the file and copy the text exactly`);
  if (count > 1) throw new Error(`oldText appears ${count} times in ${name}; include more lines around it`);
  return content.replace(oldText, () => newText);
}
