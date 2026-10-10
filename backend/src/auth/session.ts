import type { RequestHandler } from "express";
import type { User as SessionUser } from "shared";
import { User } from "../models/User.js";

export const ACCESS_TOKEN = "access_token";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

// Identity comes from the saved session, never a username cookie or request body.
export const requireUser: RequestHandler = async (req, res, next) => {
  const token: unknown = req.cookies?.[ACCESS_TOKEN];
  if (typeof token !== "string" || !token.length) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  const user = await User.findOne({
    where: { access_token: token },
    attributes: ["username", "authority"],
  });
  if (!user) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  req.user = { username: user.username, authority: user.authority };
  next();
};

// Mounted at /api before every API route. Login establishes the session.
export const requireApiUser: RequestHandler = (req, res, next) => {
  if (req.method === "POST" && /^\/users\/login\/?$/i.test(req.path)) {
    return next();
  }
  return requireUser(req, res, next);
};
