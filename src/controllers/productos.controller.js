import { pool } from "../config/db.js";

function normalizeSector(value) {
  const s = String(value ?? "").trim().toUpperCase();

  if (s === "LIQUIDOS" || s === "LIQUIDO") return "LIQUIDOS";
  if (s === "CUEROS" || s === "CUERO") return "CUEROS";
  if (s === "PLASTICOS" || s === "PLASTICO") return "PLASTICOS";
  if (s === "ESTAMPAS" || s === "ESTAMPA") return "ESTAMPAS";

  return "PLASTICOS";
}

function toMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

function toInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function normText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normKey(value) {
  return normText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProducto(row) {
  return {
    id: Number(row.id),
    nombre: row.nombre || "",
    codigo: row.codigo || "",
    codigoInterno: row.codigo || "",
    categoria: row.categoria || null,
    precio: Number(row.precio || 0),
    stock: Number(row.stock || 0),
    sector: normalizeSector(row.sector),
    activo: row.activo !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureProductosSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS productos (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      codigo TEXT,
      categoria TEXT,
      precio NUMERIC DEFAULT 0,
      stock INTEGER DEFAULT 0,
      sector TEXT DEFAULT 'PLASTICOS',
      activo BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS codigo TEXT
  `);

  await pool.query(`
    ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS categoria TEXT
  `);

  await pool.query(`
    ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS precio NUMERIC DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS sector TEXT DEFAULT 'PLASTICOS'
  `);

  await pool.query(`
    ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE
  `);

  await pool.query(`
    ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS productos_codigo_unique_idx
    ON productos (LOWER(codigo))
    WHERE codigo IS NOT NULL AND codigo <> ''
  `);
}

async function findProductoDuplicado({ nombre, codigo, excludeId }) {
  const codigoClean = normText(codigo);
  const nombreKey = normKey(nombre);

  const result = await pool.query(
    `
    SELECT *
    FROM productos
    WHERE ($1::text IS NOT NULL AND $1::text <> '' AND LOWER(codigo) = LOWER($1))
       OR ($2::text <> '' AND LOWER(nombre) = LOWER($2))
    `,
    [codigoClean || null, nombreKey]
  );

  const rows = result.rows.filter((row) => {
    if (!excludeId) return true;
    return Number(row.id) !== Number(excludeId);
  });

  return rows[0] || null;
}

export async function getProductos(_req, res) {
  try {
    await ensureProductosSchema();

    const result = await pool.query(
      `
      SELECT id, nombre, codigo, categoria, precio, stock, sector, activo, created_at, updated_at
      FROM productos
      ORDER BY activo DESC, nombre ASC, id DESC
      `
    );

    res.json(result.rows.map(normalizeProducto));
  } catch (error) {
    console.error("Error al obtener productos:", error);
    res.status(500).json({
      ok: false,
      error: "Error al obtener productos",
      detail: error.message,
    });
  }
}

export async function getProductoById(req, res) {
  try {
    await ensureProductosSchema();

    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT id, nombre, codigo, categoria, precio, stock, sector, activo, created_at, updated_at
      FROM productos
      WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Producto no encontrado",
      });
    }

    res.json(normalizeProducto(result.rows[0]));
  } catch (error) {
    console.error("Error al obtener producto:", error);
    res.status(500).json({
      ok: false,
      error: "Error al obtener producto",
      detail: error.message,
    });
  }
}

export async function crearProducto(req, res) {
  try {
    await ensureProductosSchema();

    const nombre = normText(req.body.nombre || req.body.descripcion);
    const codigo = normText(
      req.body.codigo || req.body.codigoInterno || req.body.sku
    );
    const categoria = req.body.categoria ? normText(req.body.categoria) : null;
    const precio = toMoney(req.body.precio ?? req.body.precioUnitario ?? 0);
    const stock = toInt(req.body.stock ?? req.body.cantidad ?? 0);
    const sector = normalizeSector(req.body.sector);
    const activo = req.body.activo !== false;

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "El nombre es obligatorio",
      });
    }

    const duplicado = await findProductoDuplicado({ nombre, codigo });

    if (duplicado) {
      const updated = await pool.query(
        `
        UPDATE productos
        SET
          nombre = COALESCE(NULLIF($1, ''), nombre),
          codigo = COALESCE(NULLIF($2, ''), codigo),
          categoria = COALESCE($3, categoria),
          precio = CASE WHEN $4::numeric > 0 THEN $4 ELSE precio END,
          stock = GREATEST(stock, $5),
          sector = $6,
          activo = TRUE,
          updated_at = NOW()
        WHERE id = $7
        RETURNING id, nombre, codigo, categoria, precio, stock, sector, activo, created_at, updated_at
        `,
        [
          nombre,
          codigo,
          categoria,
          precio,
          stock,
          sector,
          duplicado.id,
        ]
      );

      return res.status(200).json({
        ok: true,
        duplicated: true,
        producto: normalizeProducto(updated.rows[0]),
        ...normalizeProducto(updated.rows[0]),
      });
    }

    const result = await pool.query(
      `
      INSERT INTO productos (
        nombre,
        codigo,
        categoria,
        precio,
        stock,
        sector,
        activo,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id, nombre, codigo, categoria, precio, stock, sector, activo, created_at, updated_at
      `,
      [
        nombre,
        codigo || null,
        categoria,
        precio,
        stock,
        sector,
        activo,
      ]
    );

    res.status(201).json({
      ok: true,
      producto: normalizeProducto(result.rows[0]),
      ...normalizeProducto(result.rows[0]),
    });
  } catch (error) {
    console.error("Error al crear producto:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        ok: false,
        error: "Ya existe un producto con ese código",
      });
    }

    res.status(500).json({
      ok: false,
      error: "Error al crear producto",
      detail: error.message,
    });
  }
}

export async function actualizarProducto(req, res) {
  try {
    await ensureProductosSchema();

    const { id } = req.params;

    const current = await pool.query(
      `
      SELECT *
      FROM productos
      WHERE id = $1
      `,
      [id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Producto no encontrado",
      });
    }

    const prev = current.rows[0];

    const nombre = normText(req.body.nombre ?? prev.nombre);
    const codigo = normText(
      req.body.codigo ?? req.body.codigoInterno ?? prev.codigo ?? ""
    );
    const categoria =
      req.body.categoria !== undefined
        ? req.body.categoria
          ? normText(req.body.categoria)
          : null
        : prev.categoria;
    const precio =
      req.body.precio !== undefined || req.body.precioUnitario !== undefined
        ? toMoney(req.body.precio ?? req.body.precioUnitario)
        : toMoney(prev.precio);
    const stock =
      req.body.stock !== undefined
        ? toInt(req.body.stock)
        : toInt(prev.stock);
    const sector =
      req.body.sector !== undefined
        ? normalizeSector(req.body.sector)
        : normalizeSector(prev.sector);
    const activo =
      req.body.activo !== undefined ? Boolean(req.body.activo) : prev.activo !== false;

    if (!nombre) {
      return res.status(400).json({
        ok: false,
        error: "El nombre es obligatorio",
      });
    }

    const duplicado = await findProductoDuplicado({
      nombre,
      codigo,
      excludeId: id,
    });

    if (duplicado) {
      return res.status(409).json({
        ok: false,
        error: "Ya existe otro producto con ese nombre o código",
      });
    }

    const result = await pool.query(
      `
      UPDATE productos
      SET
        nombre = $1,
        codigo = $2,
        categoria = $3,
        precio = $4,
        stock = $5,
        sector = $6,
        activo = $7,
        updated_at = NOW()
      WHERE id = $8
      RETURNING id, nombre, codigo, categoria, precio, stock, sector, activo, created_at, updated_at
      `,
      [
        nombre,
        codigo || null,
        categoria,
        precio,
        stock,
        sector,
        activo,
        id,
      ]
    );

    res.json({
      ok: true,
      producto: normalizeProducto(result.rows[0]),
      ...normalizeProducto(result.rows[0]),
    });
  } catch (error) {
    console.error("Error al actualizar producto:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        ok: false,
        error: "Ya existe un producto con ese código",
      });
    }

    res.status(500).json({
      ok: false,
      error: "Error al actualizar producto",
      detail: error.message,
    });
  }
}

export async function patchProducto(req, res) {
  try {
    await ensureProductosSchema();

    const { id } = req.params;

    const current = await pool.query(
      `
      SELECT *
      FROM productos
      WHERE id = $1
      `,
      [id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Producto no encontrado",
      });
    }

    const prev = current.rows[0];

    const nombre =
      req.body.nombre !== undefined ? normText(req.body.nombre) : prev.nombre;
    const codigo =
      req.body.codigo !== undefined || req.body.codigoInterno !== undefined
        ? normText(req.body.codigo ?? req.body.codigoInterno)
        : prev.codigo;
    const categoria =
      req.body.categoria !== undefined
        ? req.body.categoria
          ? normText(req.body.categoria)
          : null
        : prev.categoria;
    const precio =
      req.body.precio !== undefined || req.body.precioUnitario !== undefined
        ? toMoney(req.body.precio ?? req.body.precioUnitario)
        : toMoney(prev.precio);
    const stock =
      req.body.stock !== undefined ? toInt(req.body.stock) : toInt(prev.stock);
    const sector =
      req.body.sector !== undefined
        ? normalizeSector(req.body.sector)
        : normalizeSector(prev.sector);
    const activo =
      req.body.activo !== undefined ? Boolean(req.body.activo) : prev.activo !== false;

    const result = await pool.query(
      `
      UPDATE productos
      SET
        nombre = $1,
        codigo = $2,
        categoria = $3,
        precio = $4,
        stock = $5,
        sector = $6,
        activo = $7,
        updated_at = NOW()
      WHERE id = $8
      RETURNING id, nombre, codigo, categoria, precio, stock, sector, activo, created_at, updated_at
      `,
      [
        nombre,
        codigo || null,
        categoria,
        precio,
        stock,
        sector,
        activo,
        id,
      ]
    );

    res.json({
      ok: true,
      producto: normalizeProducto(result.rows[0]),
      ...normalizeProducto(result.rows[0]),
    });
  } catch (error) {
    console.error("Error parcial al actualizar producto:", error);
    res.status(500).json({
      ok: false,
      error: "Error parcial al actualizar producto",
      detail: error.message,
    });
  }
}

export async function eliminarProducto(req, res) {
  try {
    await ensureProductosSchema();

    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE productos
      SET activo = FALSE,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, nombre, codigo, categoria, precio, stock, sector, activo, created_at, updated_at
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: "Producto no encontrado",
      });
    }

    res.json({
      ok: true,
      deleted: true,
      producto: normalizeProducto(result.rows[0]),
    });
  } catch (error) {
    console.error("Error al eliminar producto:", error);
    res.status(500).json({
      ok: false,
      error: "Error al eliminar producto",
      detail: error.message,
    });
  }
}