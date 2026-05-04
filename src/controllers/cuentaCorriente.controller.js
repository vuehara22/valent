import { pool } from "../config/db.js";

function normalizeMovimiento(row) {
  return {
    id: String(row.id),
    clienteId: row.cliente_id ? Number(row.cliente_id) : undefined,
    clienteNombre: row.cliente_nombre,
    fecha: row.fecha,
    tipo: row.tipo,
    referencia: row.referencia || undefined,
    pedidoId: row.pedido_id ? Number(row.pedido_id) : undefined,
    monto: Number(row.monto || 0),
    nota: row.nota || undefined,
    metodoPago: row.metodo_pago || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeId(prefix = "cc") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function getMovimientosCuentaCorriente(req, res) {
  try {
    const result = await pool.query(`
      SELECT *
      FROM cuenta_corriente_movimientos
      ORDER BY fecha DESC, created_at DESC
    `);

    res.json({
      ok: true,
      movimientos: result.rows.map(normalizeMovimiento),
    });
  } catch (error) {
    console.error("Error obteniendo cuenta corriente:", error);
    res.status(500).json({
      ok: false,
      error: "Error obteniendo cuenta corriente",
      detail: error.message,
    });
  }
}

export async function createMovimientoCuentaCorriente(req, res) {
  try {
    const {
      id,
      clienteId,
      clienteNombre,
      fecha,
      tipo,
      referencia,
      pedidoId,
      monto,
      nota,
      metodoPago,
    } = req.body;

    if (!clienteNombre || !tipo || monto === undefined || monto === null) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos obligatorios",
      });
    }

    const tipoFinal = String(tipo).toUpperCase();

    if (!["FACTURA", "PAGO", "AJUSTE"].includes(tipoFinal)) {
      return res.status(400).json({
        ok: false,
        error: "Tipo de movimiento inválido",
      });
    }

    const montoNumber = Number(monto);

    if (!Number.isFinite(montoNumber) || montoNumber === 0) {
      return res.status(400).json({
        ok: false,
        error: "Monto inválido",
      });
    }

    const finalMonto =
      tipoFinal === "AJUSTE" ? montoNumber : Math.abs(montoNumber);

    const result = await pool.query(
      `
      INSERT INTO cuenta_corriente_movimientos (
        id,
        cliente_id,
        cliente_nombre,
        fecha,
        tipo,
        referencia,
        pedido_id,
        monto,
        nota,
        metodo_pago,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, COALESCE($4::timestamp, NOW()), $5, $6, $7, $8, $9, $10, NOW(), NOW()
      )
      RETURNING *
      `,
      [
        id || makeId(tipoFinal.toLowerCase()),
        clienteId ? Number(clienteId) : null,
        String(clienteNombre).trim(),
        fecha || null,
        tipoFinal,
        referencia?.trim() || null,
        pedidoId ? Number(pedidoId) : null,
        finalMonto,
        nota?.trim() || null,
        tipoFinal === "PAGO" ? metodoPago || "TRANSFERENCIA" : null,
      ]
    );

    res.status(201).json({
      ok: true,
      movimiento: normalizeMovimiento(result.rows[0]),
    });
  } catch (error) {
    console.error("Error creando movimiento:", error);
    res.status(500).json({
      ok: false,
      error: "Error creando movimiento",
      detail: error.message,
    });
  }
}

export async function deleteMovimientoCuentaCorriente(req, res) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM cuenta_corriente_movimientos
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: "Movimiento no encontrado",
      });
    }

    res.json({
      ok: true,
      deleted: true,
      movimiento: normalizeMovimiento(result.rows[0]),
    });
  } catch (error) {
    console.error("Error eliminando movimiento:", error);
    res.status(500).json({
      ok: false,
      error: "Error eliminando movimiento",
      detail: error.message,
    });
  }
}