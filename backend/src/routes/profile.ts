import express from "express";
export const profileRouter = express.Router();

profileRouter.get("/", (req, res) => {
  // read from cookies
  const username = req.cookies.username;
  if (!username) return res.status(401).json({ error: "username not found" });
  return res.json({ username });
});

profileRouter.post("/", (req, res) => {
  const { username } = req.body ?? {};
  if (!username?.length) return res.status(400).json({ error: "username is required" });

  // save username to cookies
  res.cookie("username", username, { httpOnly: true, sameSite: "strict", maxAge: 1000 * 60 * 60 * 24 * 365 });
  return res.status(200).json({ username });
});