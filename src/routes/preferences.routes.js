import express from "express";
import {
  getPreference,
  savePreference,
  deletePreference,
} from "../controllers/preferences.controller.js";

const router = express.Router();

router.get("/:userId/:key", getPreference);
router.put("/:userId/:key", savePreference);
router.delete("/:userId/:key", deletePreference);

export default router;