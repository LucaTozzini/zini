import assert from "node:assert/strict";
import { test } from "node:test";
import { testGoogleSearchConsole } from "./googleSearchConsole.js";
import { serviceAccountEmail } from "./googleServiceAccount.js";

const key = JSON.stringify({ type: "service_account", client_email: "zini@project.iam.gserviceaccount.com", private_key: "x" });

test("a key that isn't a service account's says so before calling Google", async () => {
  await assert.rejects(testGoogleSearchConsole("not json", "sc-domain:example.com"), /paste the whole JSON file/);
  await assert.rejects(
    testGoogleSearchConsole(JSON.stringify({ type: "authorized_user" }), "sc-domain:example.com"),
    /isn't a service account key/,
  );
});

test("a connected key is shown by its service account's email", () => {
  assert.equal(serviceAccountEmail(key), "zini@project.iam.gserviceaccount.com");
  assert.equal(serviceAccountEmail("not json"), "a service account");
});
