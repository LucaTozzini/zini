import assert from "node:assert/strict";
import test from "node:test";
import type { LinearClient } from "@linear/sdk";
import { downloadLinearFile, fetchLinearDocument, linearUploads } from "../integrations/linear.js";
import { fileContent } from "./linearFileTools.js";

const upload = (name: string) => `https://uploads.linear.app/org/${name}`;

test("uploads are found in markdown once each, named by their link's text", () => {
  const markdown = `![mockup](${upload("a")})\nSee [spec.pdf](${upload("b")}) and ${upload("c")}.\n![](${upload("a")}) [elsewhere](https://example.com/x)`;
  assert.deepEqual(linearUploads(markdown), [
    { url: upload("a"), name: "mockup" },
    { url: upload("b"), name: "spec.pdf" },
    { url: upload("c") },
  ]);
});

test("a document is looked up by the id at the end of its URL", async () => {
  const ids: string[] = [];
  const client = {
    client: {
      rawRequest: async (_query: string, { id }: { id: string }) => {
        ids.push(id);
        return {
          data: {
            document: { id: "uuid", title: "Spec", content: `![m](${upload("a")})`, url: "", updatedAt: "", project: null },
          },
        };
      },
    },
  } as unknown as LinearClient;
  const document = await fetchLinearDocument(client, "https://linear.app/team/document/product-spec-v01-b6eaca1eb7c1");
  await fetchLinearDocument(client, "b50e6f06-1314-4a16-a348-eca1238d0d61");
  assert.deepEqual(ids, ["b6eaca1eb7c1", "b50e6f06-1314-4a16-a348-eca1238d0d61"]);
  assert.deepEqual(document.files, [{ url: upload("a"), name: "m" }]);
});

test("the API key is only sent to Linear's uploads host", async () => {
  await assert.rejects(downloadLinearFile("https://example.com/uploads.linear.app/x"), /Only files on uploads\.linear\.app/);
});

test("files come back as images, PDFs, text, or a note that they can't be shown", () => {
  const bytes = Buffer.from("hello");
  assert.deepEqual(fileContent("a.png", "image/png", bytes), [
    { type: "input_text", text: "a.png (image/png, 5 bytes)" },
    { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" },
  ]);
  assert.deepEqual(fileContent("a.pdf", "application/pdf", bytes), [
    { type: "input_text", text: "a.pdf (application/pdf, 5 bytes)" },
    { type: "input_file", filename: "a.pdf", file_data: "data:application/pdf;base64,aGVsbG8=" },
  ]);
  assert.equal(fileContent("a.svg", "image/svg+xml", bytes), "a.svg (image/svg+xml, 5 bytes)\n\nhello");
  assert.equal(
    fileContent("a.zip", "application/zip", bytes),
    "a.zip (application/zip, 5 bytes): this type of file can't be shown.",
  );
});
