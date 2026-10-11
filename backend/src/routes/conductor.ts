import express from "express";
import { getConductorStatus } from "../conductor/conductor.js";
const conductorRouter = express.Router();

conductorRouter.get("/status", (req, res) => {
  const status = getConductorStatus();
  res.json(status);
});

export default conductorRouter;