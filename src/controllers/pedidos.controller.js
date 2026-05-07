import { pool } from "../config/db.js";

function safeJson(value, fallback) {
  if (value == null) return fallback;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  return value;
}

function normalizeEstados(value) {
  const parsed = safeJson(value, value);

  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed;
  }

  if (typeof parsed === "string" && parsed.trim()) {
    return [
      {
        estado: parsed.trim().toUpperCase(),
        at: new Date().toISOString(),
      },
    ];
  }

  return [
    {
      estado: "PENDIENTE",
      at: new Date().toISOString(),
    },
  ];
}

function normalizeExtras(value) {
  const parsed = safeJson(value, {});
  return parsed && typeof parsed === "object" ? parsed : {};
}

function getEstadoString(value) {
  if (typeof value === "string") return value.toUpperCase();

  if (value && typeof value === "object" && "estado" in value) {
    return String(value.estado || "").toUpperCase();
  }

  return "";
}

function isPedidoCancelado(row) {
  const estados = normalizeEstados(row.estados);
  const extras = normalizeExtras(row.extras);

  return (
    estados.some((e) => getEstadoString(e) === "CANCELADO") ||
    extras.canceladoAt ||
    extras.canceladoPorPresupuestoId ||
    extras.cancelado === true ||
    extras.presupuesto?.estado === "CANCELADO"
  );
}

function mapPedido(row) {
  const estados = normalizeEstados(row.estados);
  const extras = normalizeExtras(row.extras);

  return {
    id: row.id,
    cliente: row.cliente,
    sector: row.sector,
    prioridad: row.prioridad,
    dias: row.dias,
    estados,
    estado: getEstadoString(estados[estados.length - 1]) || "PENDIENTE",
    cancelado: isPedidoCancelado(row),
    extras,
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
    res.status(500).json({
      ok: false,
      message: "Error al obtener pedidos",
      detail: error.message,
    });
  }
}

export async function getPedidoById(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({
        ok: false,
        message: "ID inválido",
      });
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
      return res.status(404).json({
        ok: false,
        message: "Pedido no encontrado",
      });
    }

    res.json(mapPedido(result.rows[0]));
  } catch (error) {
    console.error("Error getPedidoById:", error);
    res.status(500).json({
      ok: false,
      message: "Error al obtener pedido",
      detail: error.message,
    });
  }
}

function normalizePedidoBody(body, current = null) {
  const currentExtras = current ? normalizeExtras(current.extras) : {};
  const currentEstados = current ? normalizeEstados(current.estados) : [];

  return {
    cliente: String(body.cliente ?? current?.cliente ?? "").trim(),
    sector: String(body.sector ?? current?.sector ?? "").trim(),
    prioridad: String(body.prioridad ?? current?.prioridad ?? "OK").trim(),
    dias: Number(body.dias ?? current?.dias ?? 0) || 0,
    estados:
      Array.isArray(body.estados) && body.estados.length > 0
        ? body.estados
        : currentEstados.length
        ? currentEstados
        : [
            {
              estado: "PENDIENTE",
              at: new Date().toISOString(),
            },
          ],
    extras:
      body.extras && typeof body.extras === "object"
        ? {
            ...currentExtras,
            ...body.extras,
          }
        : currentExtras,
    fecha:
      body.fecha ??
      current?.fecha ??
      new Date().toISOString(),
  };
}

export async function createPedido(req, res) {
  try {
    const pedido = normalizePedidoBody(req.body);

    if (!pedido.cliente) {
      return res.status(400).json({
        ok: false,
        message: "El cliente es obligatorio",
      });
    }

    const presupuestoId =
      pedido.extras?.presupuestoId ??
      pedido.extras?.presupuesto?.id ??
      null;

    if (presupuestoId) {
      const existing = await pool.query(
        `
        SELECT *
        FROM pedidos
        WHERE extras->>'presupuestoId' = $1
        LIMIT 1
        `,
        [String(presupuestoId)]
      );

      if (existing.rowCount > 0) {
        return res.status(200).json(mapPedido(existing.rows[0]));
      }
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
        fecha,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW(), NOW())
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
    console.error("Error createPedido:", error);
    res.status(500).json({
      ok: false,
      message: "Error al crear pedido",
      detail: error.message,
    });
  }
}

export async function updatePedido(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({
        ok: false,
        message: "ID inválido",
      });
    }

    const currentResult = await pool.query(
      `
      SELECT *
      FROM pedidos
      WHERE id = $1
      `,
      [id]
    );

    if (currentResult.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        message: "Pedido no encontrado",
      });
    }

    const current = currentResult.rows[0];
    const pedido = normalizePedidoBody(req.body, current);

    if (!pedido.cliente) {
      return res.status(400).json({
        ok: false,
        message: "El cliente es obligatorio",
      });
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

    res.json(mapPedido(result.rows[0]));
  } catch (error) {
    console.error("Error updatePedido:", error);
    res.status(500).json({
      ok: false,
      message: "Error al actualizar pedido",
      detail: error.message,
    });
  }
}

export async function patchPedido(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({
        ok: false,
        message: "ID inválido",
      });
    }

    const currentResult = await pool.query(
      `
      SELECT *
      FROM pedidos
      WHERE id = $1
      `,
      [id]
    );

    if (currentResult.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        message: "Pedido no encontrado",
      });
    }

    const current = currentResult.rows[0];
    const currentExtras = normalizeExtras(current.extras);
    const currentEstados = normalizeEstados(current.estados);

    const nextExtras =
      req.body.extras && typeof req.body.extras === "object"
        ? {
            ...currentExtras,
            ...req.body.extras,
          }
        : currentExtras;

    const nextEstados =
      Array.isArray(req.body.estados) && req.body.estados.length > 0
        ? req.body.estados
        : currentEstados;

    const result = await pool.query(
      `
      UPDATE pedidos
      SET
        cliente = COALESCE($1, cliente),
        sector = COALESCE($2, sector),
        prioridad = COALESCE($3, prioridad),
        dias = COALESCE($4, dias),
        estados = $5::jsonb,
        extras = $6::jsonb,
        fecha = COALESCE($7, fecha),
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
      `,
      [
        req.body.cliente !== undefined ? String(req.body.cliente).trim() : null,
        req.body.sector !== undefined ? String(req.body.sector).trim() : null,
        req.body.prioridad !== undefined ? String(req.body.prioridad).trim() : null,
        req.body.dias !== undefined ? Number(req.body.dias) || 0 : null,
        JSON.stringify(nextEstados),
        JSON.stringify(nextExtras),
        req.body.fecha !== undefined ? req.body.fecha : null,
        id,
      ]
    );

    res.json(mapPedido(result.rows[0]));
  } catch (error) {
    console.error("Error patchPedido:", error);
    res.status(500).json({
      ok: false,
      message: "Error al actualizar parcialmente pedido",
      detail: error.message,
    });
  }
}

export async function deletePedido(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({
        ok: false,
        message: "ID inválido",
      });
    }

    const current = await pool.query(
      `
      SELECT *
      FROM pedidos
      WHERE id = $1
      `,
      [id]
    );

    if (current.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        message: "Pedido no encontrado",
      });
    }

    const row = current.rows[0];
    const estados = normalizeEstados(row.estados);
    const alreadyCanceled = estados.some(
      (e) => getEstadoString(e) === "CANCELADO"
    );

    const nextEstados = alreadyCanceled
      ? estados
      : [
          ...estados,
          {
            estado: "CANCELADO",
            at: new Date().toISOString(),
          },
        ];

    const extras = {
      ...normalizeExtras(row.extras),
      canceladoAt: new Date().toISOString(),
    };

    const result = await pool.query(
      `
      UPDATE pedidos
      SET
        estados = $1::jsonb,
        extras = $2::jsonb,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
      `,
      [JSON.stringify(nextEstados), JSON.stringify(extras), id]
    );

    res.json({
      ok: true,
      pedido: mapPedido(result.rows[0]),
    });
  } catch (error) {
    console.error("Error deletePedido:", error);
    res.status(500).json({
      ok: false,
      message: "Error al cancelar pedido",
      detail: error.message,
    });
  }
}