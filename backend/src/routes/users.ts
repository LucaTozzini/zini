import bcrypt from "bcryptjs";
import express from "express";
import crypto from "crypto";
import { User } from "../models/User.js";
import { ACCESS_TOKEN } from "../auth/session.js";
const usersRouter = express.Router();

usersRouter.post("/login", async (req, res) => {
  if (!req.body.username || !req.body.password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const user = await User.findOne({ where: { username: req.body.username } });
  if (!user) {
    return res.status(400).json({ error: "Incorrect username or password" });
  }

  const match = await bcrypt.compare(req.body.password, user.password_hash);
  if (!match) {
    return res.status(400).json({ error: "Incorrect username or password" });
  }

  // create an access token
  const accessToken = crypto.randomUUID();

  // save access token
  await user.update({ access_token: accessToken });

  // set access token in res
  res.cookie(ACCESS_TOKEN, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: 1000 * 60 * 60 * 24, // 1 day, in milliseconds
  });

  res.json({ username: user.username, authority: user.authority });
});

usersRouter.post("/logout", async (req, res) => {
  const accessToken = req.cookies.access_token;

  if (accessToken?.length) {
    await User.update({ access_token: null }, { where: { access_token: accessToken } });
  }

  res.clearCookie(ACCESS_TOKEN, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
  });

  res.sendStatus(200);
});

usersRouter.get("/me", (req, res) => {
  res.json(req.user);
});

export { usersRouter };
