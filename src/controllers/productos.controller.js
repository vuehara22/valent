import pool from "../config/db.js";

function normalizeSector(value) {
  const s = String(value ?? "").trim().toUpperCase();
  if (s === "LIQUIDOS") return "LIQUIDOS";
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

export async function getProductos(_req, res) {
  try {
    const result = await pool.query(
      `SELECT id, nombre, categoria, precio, stock, sector, activo
       FROM productos
       ORDER BY id DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener productos:", error);
    res.status(500).json({ error: "Error al obtener productos" });
  }
}

export async function getProductoById(req, res) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, nombre, categoria, precio, stock, sector, activo
       FROM productos
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error al obtener producto:", error);
    res.status(500).json({ error: "Error al obtener producto" });
  }
}

export async function crearProducto(req, res) {
  try {
    const {
      nombre,
      categoria = null,
      precio = 0,
      stock = 0,
      sector = "PLASTICOS",
      activo = true,
    } = req.body;

    if (!String(nombre ?? "").trim()) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }

    const result = await pool.query(
      `INSERT INTO productos (nombre, categoria, precio, stock, sector, activo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, categoria, precio, stock, sector, activo`,
      [
        String(nombre).trim(),
        categoria ? String(categoria).trim() : null,
        toMoney(precio),
        toInt(stock),
        normalizeSector(sector),
        Boolean(activo),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error al crear producto:", error);
    res.status(500).json({ error: "Error al crear producto" });
  }
}

export async function actualizarProducto(req, res) {
  try {
    const { id } = req.params;
    const {
      nombre,
      categoria = null,
      precio = 0,
      stock = 0,
      sector = "PLASTICOS",
      activo = true,
    } = req.body;

    if (!String(nombre ?? "").trim()) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }

    const result = await pool.query(
      `UPDATE productos
       SET nombre = $1,
           categoria = $2,
           precio = $3,
           stock = $4,
           sector = $5,
           activo = $6,
           updated_at = NOW()
       WHERE id = $7
       RETURNING id, nombre, categoria, precio, stock, sector, activo`,
      [
        String(nombre).trim(),
        categoria ? String(categoria).trim() : null,
        toMoney(precio),
        toInt(stock),
        normalizeSector(sector),
        Boolean(activo),
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error al actualizar producto:", error);
    res.status(500).json({ error: "Error al actualizar producto" });
  }
}

export async function eliminarProducto(req, res) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM productos
       WHERE id = $1
       RETURNING id, nombre, categoria, precio, stock, sector, activo`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    res.json({
      ok: true,
      producto: result.rows[0],
    });
  } catch (error) {
    console.error("Error al eliminar producto:", error);
    res.status(500).json({ error: "Error al eliminar producto" });
  }
}