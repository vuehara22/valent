import { pool } from "../config/db.js";

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
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query("BEGIN");

    // =========================
    // BLOQUEAR PRESUPUESTO
    // =========================
    const pres = await client.query(
      `
      SELECT *
      FROM presupuestos
      WHERE id = $1
      FOR UPDATE
      `,
      [id]
    );

    if (!pres.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Presupuesto no encontrado",
      });
    }

    const p = pres.rows[0];

    // =========================
    // YA APROBADO
    // =========================
    if (p.aprobado && p.pedido_generado_id) {
      await client.query("COMMIT");
      return res.json(mapPresupuesto(p));
    }

    // =========================
    // BUSCAR PEDIDO EXISTENTE
    // EVITA DUPLICADOS REALES
    // =========================
    const existingPedido = await client.query(
      `
      SELECT *
      FROM pedidos
      WHERE extras->>'presupuestoId' = $1
      LIMIT 1
      `,
      [id]
    );

    let pedidoId = null;

    // =========================
    // SI YA EXISTE
    // =========================
    if (existingPedido.rows.length) {
      pedidoId = existingPedido.rows[0].id;
    } else {
      // =========================
      // NORMALIZAR SECTORES
      // =========================
      const sectoresAsignados = Array.isArray(p.sectores_asignados)
        ? [...new Set(p.sectores_asignados)]
        : [];

      const sectorPrincipal =
        sectoresAsignados[0] || p.sector || "plastico";

      // =========================
      // ESTADOS CON TIMESTAMP
      // =========================
      const estadosIniciales = [
        {
          estado: "PENDIENTE",
          at: new Date().toISOString(),
        },
      ];

      // =========================
      // CREAR PEDIDO
      // =========================
      const pedidoInsert = await client.query(
        `
        INSERT INTO pedidos (
          cliente,
          sector,
          prioridad,
          dias,
          estados,
          extras,
          fecha,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6::jsonb,
          $7,
          NOW(),
          NOW()
        )
        RETURNING *
        `,
        [
          p.cliente || "Sin cliente",

          // compatibilidad visual actual
          sectorPrincipal,

          p.prioridad || "OK",

          Number(p.dias || 0),

          JSON.stringify(estadosIniciales),

          JSON.stringify({
            origen: "PRESUPUESTO",

            presupuestoId: p.id,

            clienteId: p.cliente_id || null,

            sectoresAsignados,

            stockDescontado: true,

            stockDescontadoAt: new Date().toISOString(),

            presupuesto: {
              id: p.id,

              numero: p.numero || "",

              fecha: p.fecha || "",

              validez: p.validez || "",

              cuit: p.cuit || "",

              domicilio: p.domicilio || "",

              ubicacion: p.ubicacion || "",

              telefono: p.telefono || "",

              condVenta: p.cond_venta || "",

              condIva: p.cond_iva || "",

              detalle: p.detalle || "",

              cliente: p.cliente || "",

              estado: "APROBADO",

              items: Array.isArray(p.items)
                ? p.items
                : [],

              totals:
                p.totals || {
                  subtotal: 0,
                  iva: 0,
                  total: 0,
                },
            },
          }),

          new Date().toISOString(),
        ]
      );

      pedidoId = pedidoInsert.rows[0].id;
    }

    // =========================
    // ACTUALIZAR PRESUPUESTO
    // =========================
    const result = await client.query(
      `
      UPDATE presupuestos
      SET
        aprobado = TRUE,
        estado = 'APROBADO',
        aprobado_at = NOW(),
        pedido_generado_id = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [pedidoId, id]
    );

    await client.query("COMMIT");

    return res.json(mapPresupuesto(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(
      "Error al aprobar presupuesto:",
      error
    );

    return res.status(500).json({
      error: "Error al aprobar presupuesto",
    });
  } finally {
    client.release();
  }
}

export async function eliminarPresupuesto(req, res) {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query("BEGIN");

    const pres = await client.query(
      `
      SELECT *
      FROM presupuestos
      WHERE id = $1
      FOR UPDATE
      `,
      [id]
    );

    if (!pres.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Presupuesto no encontrado" });
    }

    const presupuesto = pres.rows[0];
    const pedidoId = presupuesto.pedido_generado_id;

    if (pedidoId) {
      await client.query(
        `
        UPDATE pedidos
        SET
          estados = COALESCE(estados, '[]'::jsonb) || '["CANCELADO"]'::jsonb,
          extras = jsonb_set(
            COALESCE(extras, '{}'::jsonb),
            '{canceladoPorPresupuestoId}',
            to_jsonb($1::text),
            true
          ),
          updated_at = NOW()
        WHERE id = $2
        `,
        [id, pedidoId]
      );
    }

    const result = await client.query(
      `
      DELETE FROM presupuestos
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      presupuesto: mapPresupuesto(result.rows[0]),
      pedidoCanceladoId: pedidoId || null,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al eliminar presupuesto:", error);
    res.status(500).json({ error: "Error al eliminar presupuesto" });
  } finally {
    client.release();
  }
}