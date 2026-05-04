import { Router } from "express";
import { pool } from "../config/db.js";

const router = Router();

function mapPedido(row) {
  return {
    id: row.id,
    cliente: row.cliente,
    sector: row.sector,
    prioridad: row.prioridad,
    dias: row.dias,
    estados: row.estados || ["PENDIENTE"],
    extras: row.extras || {},
    fecha: row.fecha,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePedidoBody(body) {
  return {
    cliente: String(body.cliente || "").trim(),
    sector: String(body.sector || "").trim(),
    prioridad: String(body.prioridad || "OK").trim(),
    dias: Number(body.dias) || 0,
    estados: Array.isArray(body.estados) && body.estados.length > 0
      ? body.estados
      : ["PENDIENTE"],
    extras: body.extras && typeof body.extras === "object" ? body.extras : {},
    fecha: body.fecha || new Date().toISOString(),
  };
}

router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM pedidos
      ORDER BY fecha DESC, id DESC
    `);

    res.json(result.rows.map(mapPedido));
  } catch (error) {
    console.error("Error GET /api/pedidos:", error);
    res.status(500).json({ message: "Error al obtener pedidos" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "ID inválido" });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM pedidos
      WHERE id = $1
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    res.json(mapPedido(result.rows[0]));
  } catch (error) {
    console.error("Error GET /api/pedidos/:id:", error);
    res.status(500).json({ message: "Error al obtener pedido" });
  }
});

router.post("/", async (req, res) => {
  try {
    const pedido = normalizePedidoBody(req.body);

    if (!pedido.cliente) {
      return res.status(400).json({ message: "El cliente es obligatorio" });
    }

    const result = await pool.query(
      `
      INSERT INTO pedidos (
        cliente,
        sector,
        prioridad,
        dias,
        estados,
        extras,
        fecha
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
      RETURNING *
      `,
      [
        pedido.cliente,
        pedido.sector,
        pedido.prioridad,
        pedido.dias,
        JSON.stringify(pedido.estados),
        JSON.stringify(pedido.extras),
        pedido.fecha,
      ]
    );

    res.status(201).json(mapPedido(result.rows[0]));
  } catch (error) {
    console.error("Error POST /api/pedidos:", error);
    res.status(500).json({ message: "Error al crear pedido" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "ID inválido" });
    }

    const pedido = normalizePedidoBody(req.body);

    if (!pedido.cliente) {
      return res.status(400).json({ message: "El cliente es obligatorio" });
    }

    const result = await pool.query(
      `
      UPDATE pedidos
      SET
        cliente = $1,
        sector = $2,
        prioridad = $3,
        dias = $4,
        estados = $5::jsonb,
        extras = $6::jsonb,
        fecha = $7,
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
      `,
      [
        pedido.cliente,
        pedido.sector,
        pedido.prioridad,
        pedido.dias,
        JSON.stringify(pedido.estados),
        JSON.stringify(pedido.extras),
        pedido.fecha,
        id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    res.json(mapPedido(result.rows[0]));
  } catch (error) {
    console.error("Error PUT /api/pedidos/:id:", error);
    res.status(500).json({ message: "Error al actualizar pedido" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "ID inválido" });
    }

    const result = await pool.query(
      `
      DELETE FROM pedidos
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    res.json({ ok: true, id });
  } catch (error) {
    console.error("Error DELETE /api/pedidos/:id:", error);
    res.status(500).json({ message: "Error al eliminar pedido" });
  }
});

export default router;