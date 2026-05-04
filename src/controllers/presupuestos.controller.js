import pool from "../config/db.js";

function mapPresupuesto(row) {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    estado: row.estado,
    aprobado: row.aprobado,
    aprobadoAt: row.aprobado_at,
    pedidoGeneradoId: row.pedido_generado_id,

    clienteId: row.cliente_id,
    cliente: row.cliente,
    sector: row.sector,
    sectoresAsignados: row.sectores_asignados || [],
    prioridad: row.prioridad,
    dias: row.dias,

    numero: row.numero || "",
    remitoNro: row.numero || "",
    fecha: row.fecha || "",
    validez: row.validez || "",
    cuit: row.cuit || "",
    domicilio: row.domicilio || "",
    ubicacion: row.ubicacion || "",
    telefono: row.telefono || "",
    condVenta: row.cond_venta || "",
    condIva: row.cond_iva || "",

    detalle: row.detalle || "",
    items: row.items || [],
    totals: row.totals || { subtotal: 0, iva: 0, total: 0 },
  };
}

export async function getPresupuestos(_req, res) {
  try {
    const result = await pool.query(`
      SELECT *
      FROM presupuestos
      ORDER BY updated_at DESC
    `);

    res.json(result.rows.map(mapPresupuesto));
  } catch (error) {
    console.error("Error al obtener presupuestos:", error);
    res.status(500).json({ error: "Error al obtener presupuestos" });
  }
}

export async function getPresupuestoById(req, res) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM presupuestos WHERE id = $1`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Presupuesto no encontrado" });
    }

    res.json(mapPresupuesto(result.rows[0]));
  } catch (error) {
    console.error("Error al obtener presupuesto:", error);
    res.status(500).json({ error: "Error al obtener presupuesto" });
  }
}

export async function crearPresupuesto(req, res) {
  try {
    const p = req.body;
    const id = p.id || `pres-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const result = await pool.query(
      `
      INSERT INTO presupuestos (
        id,
        version,
        created_at,
        updated_at,
        estado,
        aprobado,
        aprobado_at,
        pedido_generado_id,
        cliente_id,
        cliente,
        sector,
        sectores_asignados,
        prioridad,
        dias,
        numero,
        fecha,
        validez,
        cuit,
        domicilio,
        ubicacion,
        telefono,
        cond_venta,
        cond_iva,
        detalle,
        items,
        totals
      )
      VALUES (
        $1,$2,NOW(),NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      )
      RETURNING *
      `,
      [
        id,
        Number(p.version || 1),
        p.estado || "BORRADOR",
        Boolean(p.aprobado),
        p.aprobadoAt || null,
        p.pedidoGeneradoId || null,
        p.clienteId || null,
        p.cliente || "Sin cliente",
        p.sector || "cuero",
        JSON.stringify(p.sectoresAsignados || []),
        p.prioridad || "OK",
        Number(p.dias || 0),
        p.numero || p.remitoNro || "",
        p.fecha || "",
        p.validez || "",
        p.cuit || "",
        p.domicilio || "",
        p.ubicacion || "",
        p.telefono || "",
        p.condVenta || "",
        p.condIva || "",
        p.detalle || "",
        JSON.stringify(p.items || []),
        JSON.stringify(p.totals || { subtotal: 0, iva: 0, total: 0 }),
      ]
    );

    res.status(201).json(mapPresupuesto(result.rows[0]));
  } catch (error) {
    console.error("Error al crear presupuesto:", error);
    res.status(500).json({ error: "Error al crear presupuesto" });
  }
}

export async function actualizarPresupuesto(req, res) {
  try {
    const { id } = req.params;
    const p = req.body;

    const result = await pool.query(
      `
      UPDATE presupuestos
      SET version = $1,
          updated_at = NOW(),
          estado = $2,
          aprobado = $3,
          aprobado_at = $4,
          pedido_generado_id = $5,
          cliente_id = $6,
          cliente = $7,
          sector = $8,
          sectores_asignados = $9,
          prioridad = $10,
          dias = $11,
          numero = $12,
          fecha = $13,
          validez = $14,
          cuit = $15,
          domicilio = $16,
          ubicacion = $17,
          telefono = $18,
          cond_venta = $19,
          cond_iva = $20,
          detalle = $21,
          items = $22,
          totals = $23
      WHERE id = $24
      RETURNING *
      `,
      [
        Number(p.version || 1),
        p.estado || "BORRADOR",
        Boolean(p.aprobado),
        p.aprobadoAt || null,
        p.pedidoGeneradoId || null,
        p.clienteId || null,
        p.cliente || "Sin cliente",
        p.sector || "cuero",
        JSON.stringify(p.sectoresAsignados || []),
        p.prioridad || "OK",
        Number(p.dias || 0),
        p.numero || p.remitoNro || "",
        p.fecha || "",
        p.validez || "",
        p.cuit || "",
        p.domicilio || "",
        p.ubicacion || "",
        p.telefono || "",
        p.condVenta || "",
        p.condIva || "",
        p.detalle || "",
        JSON.stringify(p.items || []),
        JSON.stringify(p.totals || { subtotal: 0, iva: 0, total: 0 }),
        id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Presupuesto no encontrado" });
    }

    res.json(mapPresupuesto(result.rows[0]));
  } catch (error) {
    console.error("Error al actualizar presupuesto:", error);
    res.status(500).json({ error: "Error al actualizar presupuesto" });
  }
}

export async function aprobarPresupuesto(req, res) {
  try {
    const { id } = req.params;
    const { pedidoGeneradoId } = req.body;

    const result = await pool.query(
      `
      UPDATE presupuestos
      SET aprobado = TRUE,
          estado = 'APROBADO',
          aprobado_at = NOW(),
          pedido_generado_id = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [pedidoGeneradoId || null, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Presupuesto no encontrado" });
    }

    res.json(mapPresupuesto(result.rows[0]));
  } catch (error) {
    console.error("Error al aprobar presupuesto:", error);
    res.status(500).json({ error: "Error al aprobar presupuesto" });
  }
}

export async function eliminarPresupuesto(req, res) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM presupuestos WHERE id = $1 RETURNING *`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Presupuesto no encontrado" });
    }

    res.json({ ok: true, presupuesto: mapPresupuesto(result.rows[0]) });
  } catch (error) {
    console.error("Error al eliminar presupuesto:", error);
    res.status(500).json({ error: "Error al eliminar presupuesto" });
  }
}