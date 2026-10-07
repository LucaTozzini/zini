import { Router } from "express";
import { chatGptModels, chatGptStatus, signOutChatGpt, startSignIn } from "../chatgpt.js";

// Sign in with ChatGPT, at /api/chatgpt (see chatgpt.ts): whether zini is signed in,
// starting a sign-in, signing out, and the models the plan offers.
export const chatgpt = Router();

chatgpt.get("/", async (_req, res) => {
  res.json(await chatGptStatus());
});

// Returns { url } to open in a browser on the machine running zini; the sign-in
// finishes when its callback arrives, and a chatgpt.updated event says so.
chatgpt.post("/sign-in", async (_req, res) => {
  try {
    res.json({ url: await startSignIn() });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

chatgpt.delete("/", async (_req, res) => {
  try {
    await signOutChatGpt();
    res.json(await chatGptStatus());
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

chatgpt.get("/models", async (_req, res) => {
  try {
    res.json(await chatGptModels());
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
