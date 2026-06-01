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
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "";
}

async function ensureSecurityTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuario_dispositivos (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      nombre_dispositivo TEXT,
      user_agent TEXT,
      ip TEXT,
      autorizado BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      autorizado_at TIMESTAMP,
      UNIQUE(usuario_id, device_id)
    )
  `);

  await pool.query(`
    ALTER TABLE usuario_dispositivos
    ADD COLUMN IF NOT EXISTS ip TEXT
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuracion_seguridad (
      id SERIAL PRIMARY KEY,
      solo_red_empresa BOOLEAN DEFAULT TRUE,
      ips_permitidas TEXT[]
    )
  `);

  await pool.query(`
    INSERT INTO configuracion_seguridad (solo_red_empresa, ips_permitidas)
    SELECT TRUE, ARRAY[]::TEXT[]
    WHERE NOT EXISTS (SELECT 1 FROM configuracion_seguridad)
  `);
}

async function getSecurityConfig() {
  await ensureSecurityTables();

  const result = await pool.query(`
    SELECT *
    FROM configuracion_seguridad
    ORDER BY id ASC
    LIMIT 1
  `);

  return result.rows[0] || {
    solo_red_empresa: true,
    ips_permitidas: [],
  };
}

function isIpAllowed(ip, ipsPermitidas) {
  if (!Array.isArray(ipsPermitidas) || ipsPermitidas.length === 0) {
    return true;
  }

  return ipsPermitidas.includes(ip);
}

export async function loginUsuario(req, res) {
  try {
    await ensureUsuariosTable();
    await ensureSecurityTables();

    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();
    const deviceId = String(req.body.deviceId || "").trim();
    const deviceName = String(req.body.deviceName || "Dispositivo").trim();

    const userAgent = req.headers["user-agent"] || "";
    const ip = getClientIp(req);

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Email y contraseña son obligatorios",
      });
    }

    if (!deviceId) {
      return res.status(400).json({
        ok: false,
        error: "No se pudo identificar el dispositivo.",
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM usuarios
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        ok: false,
        error: "Usuario o contraseña incorrectos",
      });
    }

    const usuario = result.rows[0];
    const usuarioNormalizado = normalizeUsuario(usuario);

    if (String(usuario.password || "") !== password) {
      return res.status(401).json({
        ok: false,
        error: "Usuario o contraseña incorrectos",
      });
    }

    if (!normalizeActivo(usuario.activo)) {
      return res.status(403).json({
        ok: false,
        error: "El usuario está inactivo",
      });
    }

    const isSuperAdmin = usuarioNormalizado.role === "SUPER_ADMIN";

    const config = await getSecurityConfig();

    if (
      !isSuperAdmin &&
      config.solo_red_empresa === true &&
      !isIpAllowed(ip, config.ips_permitidas)
    ) {
      await pool.query(
        `
        INSERT INTO usuario_dispositivos (
          usuario_id,
          device_id,
          nombre_dispositivo,
          user_agent,
          ip,
          autorizado
        )
        VALUES ($1, $2, $3, $4, $5, false)
        ON CONFLICT (usuario_id, device_id)
        DO UPDATE SET
          nombre_dispositivo = EXCLUDED.nombre_dispositivo,
          user_agent = EXCLUDED.user_agent,
          ip = EXCLUDED.ip
        `,
        [usuario.id, deviceId, deviceName, userAgent, ip]
      );

      return res.status(403).json({
        ok: false,
        requiresApproval: true,
        blockedByNetwork: true,
        error:
          "Acceso bloqueado. Solo se puede ingresar desde la red autorizada de la empresa.",
      });
    }

    if (!isSuperAdmin) {
      const deviceResult = await pool.query(
        `
        SELECT *
        FROM usuario_dispositivos
        WHERE usuario_id = $1
          AND device_id = $2
        LIMIT 1
        `,
        [usuario.id, deviceId]
      );

      const dispositivo = deviceResult.rows[0];

      if (!dispositivo) {
        await pool.query(
          `
          INSERT INTO usuario_dispositivos (
            usuario_id,
            device_id,
            nombre_dispositivo,
            user_agent,
            ip,
            autorizado
          )
          VALUES ($1, $2, $3, $4, $5, false)
          `,
          [usuario.id, deviceId, deviceName, userAgent, ip]
        );

        return res.status(403).json({
          ok: false,
          requiresApproval: true,
          error:
            "Dispositivo pendiente de autorización. Un super admin debe aprobarlo.",
        });
      }

      if (!dispositivo.autorizado) {
        return res.status(403).json({
          ok: false,
          requiresApproval: true,
          error:
            "Este dispositivo todavía no fue autorizado por un super admin.",
        });
      }
    }

    return res.json({
      ok: true,
      usuario: usuarioNormalizado,
    });
  } catch (error) {
    console.error("Error login usuario:", error);

    res.status(500).json({
      ok: false,
      error: "Error iniciando sesión",
      detail: error.message,
    });
  }
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
export async function getDispositivosPendientes(_req, res) {
  try {
    await ensureSecurityTables();

    const result = await pool.query(`
      SELECT
        ud.id,
        ud.usuario_id,
        ud.device_id,
        ud.nombre_dispositivo,
        ud.user_agent,
        ud.ip,
        ud.autorizado,
        ud.created_at,
        u.nombre,
        u.email,
        u.role
      FROM usuario_dispositivos ud
      JOIN usuarios u ON u.id = ud.usuario_id
      WHERE ud.autorizado = false
      ORDER BY ud.created_at DESC
    `);

    return res.json({
      ok: true,
      dispositivos: result.rows,
    });
  } catch (error) {
    console.error("Error obteniendo dispositivos pendientes:", error);

    return res.status(500).json({
      ok: false,
      error: "No se pudieron obtener los dispositivos pendientes.",
    });
  }
}

export async function autorizarDispositivo(req, res) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE usuario_dispositivos
      SET autorizado = true,
          autorizado_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Dispositivo no encontrado.",
      });
    }

    return res.json({
      ok: true,
      dispositivo: result.rows[0],
    });
  } catch (error) {
    console.error("Error autorizando dispositivo:", error);

    return res.status(500).json({
      ok: false,
      error: "No se pudo autorizar el dispositivo.",
    });
  }
}

export async function rechazarDispositivo(req, res) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM usuario_dispositivos
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Dispositivo no encontrado.",
      });
    }

    return res.json({
      ok: true,
      deleted: true,
    });
  } catch (error) {
    console.error("Error rechazando dispositivo:", error);

    return res.status(500).json({
      ok: false,
      error: "No se pudo rechazar el dispositivo.",
    });
  }
}