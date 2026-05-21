import express from "express";
import pool from "../config/db.js";

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

router.put("/:id/password", async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || String(password).trim().length < 4) {
      return res.status(400).json({
        ok: false,
        error: "La contraseña debe tener al menos 4 caracteres.",
      });
    }

    const result = await pool.query(
      `
      UPDATE usuarios
      SET password = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, nombre, email, role, activo, created_at, updated_at, permissions
      `,
      [String(password).trim(), id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Usuario no encontrado.",
      });
    }

    return res.json({
      ok: true,
      usuario: result.rows[0],
    });
  } catch (error) {
    console.error("Error cambiando contraseña:", error);

    return res.status(500).json({
      ok: false,
      error: "No se pudo cambiar la contraseña.",
    });
  }
});

export default router;