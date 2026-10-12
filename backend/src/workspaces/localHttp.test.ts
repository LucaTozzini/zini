import test from "node:test";
import assert from "node:assert/strict";
import { localRequest } from "./localHttp.js";

test("development HTTPS requests cannot target external or private-network hosts", async () => {
  for (const url of ["https://example.com/", "https://192.168.1.1/", "ftp://localhost/"]) {
    await assert.rejects(localRequest(new URL(url), {}), /loopback/);
  }
});
