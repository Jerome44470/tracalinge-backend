import { Router } from "express";
import { db } from "../db.js";
import { requireStaff } from "../auth.js";

export const linenTypesRouter = Router();
linenTypesRouter.use(requireStaff);

linenTypesRouter.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM linen_types ORDER BY name").all());
});
