import { pool } from "../db.js";

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

export async function getPedidos(_req, res) {
  try {
    const result = await pool.query(`
      SELECT *
      FROM pedidos
      ORDER BY fecha DESC, id DESC
    `);

    res.json(result.rows.map(mapPedido));
  } catch (error) {
    console.error("Error getPedidos:", error);
    res.status(500).json({ message: "Error al obtener pedidos" });
  }
}

export async function deletePedido(req, res) {
  try {
    const { id } = req.params;

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

    res.json({ ok: true });
  } catch (error) {
    console.error("Error deletePedido:", error);
    res.status(500).json({ message: "Error al eliminar pedido" });
  }
}