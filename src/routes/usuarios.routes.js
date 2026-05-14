import express from "express";
import {
  getUsuarios,
  createUsuario,
  updateUsuario,
  deleteUsuario,
   loginUsuario,
} from "../controllers/usuarios.controller.js";

const router = express.Router();

router.get("/", getUsuarios);
router.post("/login", loginUsuario);
router.post("/", createUsuario);
router.put("/:id", updateUsuario);
router.delete("/:id", deleteUsuario);

export default router;