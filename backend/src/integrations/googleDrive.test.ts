import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDocImages } from "./googleDrive.js";

const png = "data:image/png;base64,iVBORw0KGgo=";
const jpeg = "data:image/jpeg;base64,/9j/4AAQ+Sk=";

test("a Doc's images become markers, with the images apart", () => {
  const markdown = [
    "# Spec",
    "",
    "![][image1]",
    "",
    "Flow: ![diagram](" + jpeg + ") then ![][image2], and ![][missing].",
    "",
    `[image1]: <${png}>`,
    "",
    `[image2]: <${jpeg}>`,
    "",
  ].join("\n");

  const { text, images } = extractDocImages(markdown);
  assert.equal(
    text,
    "# Spec\n\n[image 1]\n\nFlow: [image 2: diagram] then [image 3], and ![][missing].",
    "references and inline images are numbered in order, and unknown references kept",
  );
  assert.deepEqual(images, [png, jpeg, jpeg]);
});

test("a Doc without images is left as it is", () => {
  assert.deepEqual(extractDocImages("# Notes\n\n![logo](https://example.com/logo.png)\n"), {
    text: "# Notes\n\n![logo](https://example.com/logo.png)",
    images: [],
  });
});
