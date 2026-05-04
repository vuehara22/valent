import { pool } from "../config/db.js";

function normalizeUsuario(row) {
  return {
    id: String(row.id),
    nombre: row.nombre,
    email: row.email,
    password: row.password,
    role: row.role,
    activo: row.activo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    permissions: row.permissions || {},
  };
}

export async function getUsuarios(req, res) {
  try {
    const result = await pool.query(`
      SELECT *
      FROM usuarios
      ORDER BY created_at DESC
    `);

    res.json({
      ok: true,
      usuarios: result.rows.map(normalizeUsuario),
    });
  } catch (error) {
    console.error("Error obteniendo usuarios:", error);
    res.status(500).json({
      ok: false,
      error: "Error obteniendo usuarios",
      detail: error.message,
    });
  }
}

export async function createUsuario(req, res) {
  try {
    const {
      nombre,
      email,
      password,
      role,
      activo = true,
      permissions = {},
    } = req.body;

    if (!nombre || !email || !password || !role) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos obligatorios",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO usuarios (
        nombre,
        email,
        password,
        role,
        activo,
        permissions,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
      RETURNING *
      `,
      [
        nombre.trim(),
        email.trim().toLowerCase(),
        password,
        role,
        Boolean(activo),
        JSON.stringify(permissions),
      ]
    );

    res.status(201).json({
      ok: true,
      usuario: normalizeUsuario(result.rows[0]),
    });
  } catch (error) {
    console.error("Error creando usuario:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        ok: false,
        error: "Ya existe un usuario con ese email",
      });
    }

    res.status(500).json({
      ok: false,
      error: "Error creando usuario",
      detail: error.message,
    });
  }
}

export async function updateUsuario(req, res) {
  try {
    const { id } = req.params;

    const {
      nombre,
      email,
      password,
      role,
      activo = true,
      permissions = {},
    } = req.body;

    if (!nombre || !email || !role) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos obligatorios",
      });
    }

    const current = await pool.query(
      `SELECT * FROM usuarios WHERE id = $1`,
      [id]
    );

    if (current.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Usuario no encontrado",
      });
    }

    const finalPassword = password || current.rows[0].password;

    const result = await pool.query(
      `
      UPDATE usuarios
      SET
        nombre = $1,
        email = $2,
        password = $3,
        role = $4,
        activo = $5,
        permissions = $6::jsonb,
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
      `,
      [
        nombre.trim(),
        email.trim().toLowerCase(),
        finalPassword,
        role,
        Boolean(activo),
        JSON.stringify(permissions),
        id,
      ]
    );

    res.json({
      ok: true,
      usuario: normalizeUsuario(result.rows[0]),
    });
  } catch (error) {
    console.error("Error actualizando usuario:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        ok: false,
        error: "Ya existe un usuario con ese email",
      });
    }

    res.status(500).json({
      ok: false,
      error: "Error actualizando usuario",
      detail: error.message,
    });
  }
}

export async function deleteUsuario(req, res) {
  try {
    const { id } = req.params;

    if (String(id) === "1") {
      return res.status(400).json({
        ok: false,
        error: "No se puede eliminar el usuario administrador inicial",
      });
    }

    const result = await pool.query(
      `DELETE FROM usuarios WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Usuario no encontrado",
      });
    }

    res.json({
      ok: true,
      deleted: true,
    });
  } catch (error) {
    console.error("Error eliminando usuario:", error);
    res.status(500).json({
      ok: false,
      error: "Error eliminando usuario",
      detail: error.message,
    });
  }
}