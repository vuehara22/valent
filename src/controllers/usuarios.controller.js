import { pool } from "../config/db.js";

function normalizeRole(value) {
  const raw = String(value || "LECTURA").trim().toUpperCase();

  const allowed = ["SUPER_ADMIN", "ADMIN", "VENTAS", "OPERARIO", "LECTURA"];

  if (allowed.includes(raw)) return raw;

  if (raw === "SUPERADMIN") return "SUPER_ADMIN";
  if (raw === "READONLY") return "LECTURA";
  if (raw === "USER") return "LECTURA";

  return "LECTURA";
}

function normalizeActivo(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return value;

  const raw = String(value).trim().toLowerCase();
  return !["false", "0", "no", "inactivo", "inactive"].includes(raw);
}

function normalizePermissions(value) {
  if (!value) return {};

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  return typeof value === "object" ? value : {};
}

function normalizeUsuario(row) {
  const role = normalizeRole(row.role ?? row.rol);

  return {
    id: String(row.id),
    nombre: row.nombre || "",
    email: row.email || "",
    password: row.password || "",
    role,
    rol: role,
    activo: normalizeActivo(row.activo),
    estado: normalizeActivo(row.activo) ? "ACTIVO" : "INACTIVO",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    permissions: normalizePermissions(row.permissions),
    permisos: normalizePermissions(row.permissions),
  };
}

function getBodyRole(body) {
  return normalizeRole(body.role ?? body.rol);
}

function getBodyPermissions(body) {
  return normalizePermissions(body.permissions ?? body.permisos);
}

async function ensureUsuariosTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      role TEXT NOT NULL DEFAULT 'LECTURA',
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS password TEXT
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'LECTURA'
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unique_idx
    ON usuarios (LOWER(email))
  `);
}

export async function getUsuarios(_req, res) {
  try {
    await ensureUsuariosTable();

    const result = await pool.query(`
      SELECT *
      FROM usuarios
      ORDER BY created_at DESC, id DESC
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
    await ensureUsuariosTable();

    const nombre = String(req.body.nombre || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || req.body.contrasena || "").trim();
    const role = getBodyRole(req.body);
    const activo = normalizeActivo(req.body.activo ?? req.body.estado);
    const permissions = getBodyPermissions(req.body);

    if (!nombre || !email) {
      return res.status(400).json({
        ok: false,
        error: "Nombre y email son obligatorios",
      });
    }

    const existing = await pool.query(
      `
      SELECT id
      FROM usuarios
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [email]
    );

    if (existing.rowCount > 0) {
      return res.status(409).json({
        ok: false,
        error: "Ya existe un usuario con ese email",
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
        nombre,
        email,
        password || null,
        role,
        activo,
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
    await ensureUsuariosTable();

    const { id } = req.params;

    const nombre = String(req.body.nombre || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || req.body.contrasena || "").trim();
    const role = getBodyRole(req.body);
    const activo = normalizeActivo(req.body.activo ?? req.body.estado);
    const permissions = getBodyPermissions(req.body);

    if (!nombre || !email) {
      return res.status(400).json({
        ok: false,
        error: "Nombre y email son obligatorios",
      });
    }

    const current = await pool.query(
      `
      SELECT *
      FROM usuarios
      WHERE id = $1
      `,
      [id]
    );

    if (current.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Usuario no encontrado",
      });
    }

    const emailUsed = await pool.query(
      `
      SELECT id
      FROM usuarios
      WHERE LOWER(email) = LOWER($1)
        AND id::text <> $2::text
      LIMIT 1
      `,
      [email, String(id)]
    );

    if (emailUsed.rowCount > 0) {
      return res.status(409).json({
        ok: false,
        error: "Ya existe otro usuario con ese email",
      });
    }

    const finalPassword = password || current.rows[0].password || null;

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
        nombre,
        email,
        finalPassword,
        role,
        activo,
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
    await ensureUsuariosTable();

    const { id } = req.params;

    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM usuarios`);
    const total = Number(count.rows[0]?.total || 0);

    if (total <= 1) {
      return res.status(400).json({
        ok: false,
        error: "No se puede eliminar el único usuario del sistema",
      });
    }

    const result = await pool.query(
      `
      DELETE FROM usuarios
      WHERE id = $1
      RETURNING *
      `,
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
      usuario: normalizeUsuario(result.rows[0]),
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