import { pool } from "../config/db.js";

const PEDIDO_COLUMNS = `
  id,
  cliente,
  sector,
  prioridad,
  dias,
  estados,
  extras,
  fecha,
  created_at,
  updated_at
`;

/**
 * Columnas utilizadas únicamente para el listado general.
 *
 * `archivosPedido` contiene logos, DXF y otros archivos pesados.
 * Se excluye solamente de GET /api/pedidos para evitar enviar varios MB
 * en cada carga. Los datos siguen guardados en PostgreSQL y continúan
 * disponibles en GET /api/pedidos/:id.
 */
const PEDIDO_LIST_COLUMNS = `
  id,
  cliente,
  sector,
  prioridad,
  dias,
  estados,
  COALESCE(extras, '{}'::jsonb) - 'archivosPedido' AS extras,
  fecha,
  created_at,
  updated_at
`;

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

  if (parsed && typeof parsed === "object" && "estado" in parsed) {
    return [parsed];
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

  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed)
  ) {
    return parsed;
  }

  return {};
}

function getEstadoString(value) {
  if (typeof value === "string") {
    return value.trim().toUpperCase();
  }

  if (
    value &&
    typeof value === "object" &&
    "estado" in value
  ) {
    return String(value.estado || "")
      .trim()
      .toUpperCase();
  }

  return "";
}

function isPedidoCancelado(row) {
  const estados = normalizeEstados(row.estados);
  const extras = normalizeExtras(row.extras);

  return Boolean(
    estados.some(
      (estado) =>
        getEstadoString(estado) === "CANCELADO"
    ) ||
      extras.canceladoAt ||
      extras.canceladoPorPresupuestoId ||
      extras.cancelado === true ||
      extras.presupuesto?.estado === "CANCELADO"
  );
}

function mapPedido(row) {
  const estados = normalizeEstados(row.estados);
  const extras = normalizeExtras(row.extras);
  const ultimoEstado =
    estados[estados.length - 1];

  return {
    id: row.id,
    cliente: row.cliente,
    sector: row.sector,
    prioridad: row.prioridad,
    dias: Number(row.dias) || 0,
    estados,
    estado:
      getEstadoString(ultimoEstado) ||
      "PENDIENTE",
    cancelado: isPedidoCancelado(row),
    extras,
    fecha: row.fecha,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parsePedidoId(value) {
  const id = Number(value);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return null;
  }

  return id;
}

function normalizeNullableString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  return String(value).trim();
}

function normalizeDias(value, fallback = 0) {
  if (value === undefined) return fallback;

  const dias = Number(value);

  return Number.isFinite(dias)
    ? Math.max(0, Math.trunc(dias))
    : fallback;
}

function normalizePedidoBody(body = {}, current = null) {
  const currentExtras = current
    ? normalizeExtras(current.extras)
    : {};

  const currentEstados = current
    ? normalizeEstados(current.estados)
    : [];

  const bodyExtras =
    body.extras &&
    typeof body.extras === "object" &&
    !Array.isArray(body.extras)
      ? body.extras
      : null;

  const bodyEstados =
    Array.isArray(body.estados) &&
    body.estados.length > 0
      ? body.estados
      : null;

  return {
    cliente: String(
      body.cliente ??
        current?.cliente ??
        ""
    ).trim(),

    sector: String(
      body.sector ??
        current?.sector ??
        ""
    ).trim(),

    prioridad: String(
      body.prioridad ??
        current?.prioridad ??
        "OK"
    ).trim(),

    dias: normalizeDias(
      body.dias,
      Number(current?.dias) || 0
    ),

    estados:
      bodyEstados ??
      (currentEstados.length > 0
        ? currentEstados
        : [
            {
              estado: "PENDIENTE",
              at: new Date().toISOString(),
            },
          ]),

    extras: bodyExtras
      ? {
          ...currentExtras,
          ...bodyExtras,
        }
      : currentExtras,

    fecha:
      body.fecha ??
      current?.fecha ??
      new Date().toISOString(),
  };
}

function sendDatabaseError(
  res,
  error,
  publicMessage
) {
  console.error(publicMessage, {
    message: error?.message,
    code: error?.code,
    detail: error?.detail,
  });

  const isPoolTimeout =
    String(error?.message || "")
      .toLowerCase()
      .includes(
        "timeout exceeded when trying to connect"
      );

  return res
    .status(isPoolTimeout ? 503 : 500)
    .json({
      ok: false,
      message: isPoolTimeout
        ? "La base de datos está ocupada. Intentá nuevamente."
        : publicMessage,
      code: error?.code ?? null,
    });
}

export async function getPedidos(_req, res) {
  try {
    /*
     * El listado general no necesita transportar el contenido completo de
     * logos y DXF. Excluir `extras.archivosPedido` directamente en PostgreSQL
     * evita que esos datos pesados viajen hacia Node.js y luego al navegador.
     *
     * No se elimina ni modifica información de la base de datos.
     * getPedidoById sigue usando PEDIDO_COLUMNS y devuelve el pedido completo,
     * incluyendo `extras.archivosPedido`.
     */
    const result = await pool.query(`
      SELECT ${PEDIDO_LIST_COLUMNS}
      FROM pedidos
      ORDER BY fecha DESC NULLS LAST, id DESC
    `);

    return res.json(
      result.rows.map(mapPedido)
    );
  } catch (error) {
    return sendDatabaseError(
      res,
      error,
      "Error al obtener pedidos"
    );
  }
}

export async function getPedidoById(
  req,
  res
) {
  const id = parsePedidoId(req.params.id);

  if (!id) {
    return res.status(400).json({
      ok: false,
      message: "ID inválido",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT ${PEDIDO_COLUMNS}
      FROM pedidos
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        message: "Pedido no encontrado",
      });
    }

    return res.json(
      mapPedido(result.rows[0])
    );
  } catch (error) {
    return sendDatabaseError(
      res,
      error,
      "Error al obtener pedido"
    );
  }
}

export async function createPedido(
  req,
  res
) {
  try {
    const pedido = normalizePedidoBody(
      req.body
    );

    if (!pedido.cliente) {
      return res.status(400).json({
        ok: false,
        message:
          "El cliente es obligatorio",
      });
    }

    const presupuestoId =
      pedido.extras?.presupuestoId ??
      pedido.extras?.presupuesto?.id ??
      null;

    if (
      presupuestoId !== null &&
      presupuestoId !== undefined &&
      String(presupuestoId).trim()
    ) {
      const existing =
        await pool.query(
          `
          SELECT ${PEDIDO_COLUMNS}
          FROM pedidos
          WHERE
            extras->>'presupuestoId' = $1
            OR extras->'presupuesto'->>'id' = $1
          ORDER BY id DESC
          LIMIT 1
          `,
          [String(presupuestoId).trim()]
        );

      if (
        existing.rowCount > 0
      ) {
        return res
          .status(200)
          .json(
            mapPedido(
              existing.rows[0]
            )
          );
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
      RETURNING ${PEDIDO_COLUMNS}
      `,
      [
        pedido.cliente,
        pedido.sector,
        pedido.prioridad,
        pedido.dias,
        JSON.stringify(
          pedido.estados
        ),
        JSON.stringify(
          pedido.extras
        ),
        pedido.fecha,
      ]
    );

    return res
      .status(201)
      .json(
        mapPedido(result.rows[0])
      );
  } catch (error) {
    return sendDatabaseError(
      res,
      error,
      "Error al crear pedido"
    );
  }
}

export async function updatePedido(
  req,
  res
) {
  const id = parsePedidoId(req.params.id);

  if (!id) {
    return res.status(400).json({
      ok: false,
      message: "ID inválido",
    });
  }

  try {
    const bodyExtras =
      req.body?.extras &&
      typeof req.body.extras === "object" &&
      !Array.isArray(req.body.extras)
        ? req.body.extras
        : {};

    const bodyEstados =
      Array.isArray(
        req.body?.estados
      ) &&
      req.body.estados.length > 0
        ? req.body.estados
        : null;

    const result = await pool.query(
      `
      UPDATE pedidos
      SET
        cliente = COALESCE(
          NULLIF(BTRIM($1), ''),
          cliente
        ),
        sector = COALESCE(
          $2,
          sector
        ),
        prioridad = COALESCE(
          NULLIF(BTRIM($3), ''),
          prioridad
        ),
        dias = COALESCE(
          $4,
          dias
        ),
        estados = CASE
          WHEN $5::jsonb IS NULL
            THEN estados
          ELSE $5::jsonb
        END,
        extras = COALESCE(
          extras,
          '{}'::jsonb
        ) || $6::jsonb,
        fecha = COALESCE(
          $7,
          fecha
        ),
        updated_at = NOW()
      WHERE id = $8
      RETURNING ${PEDIDO_COLUMNS}
      `,
      [
        normalizeNullableString(
          req.body?.cliente
        ) ?? null,
        normalizeNullableString(
          req.body?.sector
        ) ?? null,
        normalizeNullableString(
          req.body?.prioridad
        ) ?? null,
        req.body?.dias !== undefined
          ? normalizeDias(
              req.body.dias,
              0
            )
          : null,
        bodyEstados
          ? JSON.stringify(
              bodyEstados
            )
          : null,
        JSON.stringify(
          bodyExtras
        ),
        req.body?.fecha ??
          null,
        id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        message: "Pedido no encontrado",
      });
    }

    return res.json(
      mapPedido(result.rows[0])
    );
  } catch (error) {
    return sendDatabaseError(
      res,
      error,
      "Error al actualizar pedido"
    );
  }
}

export async function patchPedido(
  req,
  res
) {
  const id = parsePedidoId(req.params.id);

  if (!id) {
    return res.status(400).json({
      ok: false,
      message: "ID inválido",
    });
  }

  try {
    const bodyExtras =
      req.body?.extras &&
      typeof req.body.extras === "object" &&
      !Array.isArray(req.body.extras)
        ? req.body.extras
        : {};

    const bodyEstados =
      Array.isArray(
        req.body?.estados
      ) &&
      req.body.estados.length > 0
        ? req.body.estados
        : null;

    const result = await pool.query(
      `
      UPDATE pedidos
      SET
        cliente = COALESCE(
          $1,
          cliente
        ),
        sector = COALESCE(
          $2,
          sector
        ),
        prioridad = COALESCE(
          $3,
          prioridad
        ),
        dias = COALESCE(
          $4,
          dias
        ),
        estados = CASE
          WHEN $5::jsonb IS NULL
            THEN estados
          ELSE $5::jsonb
        END,
        extras = COALESCE(
          extras,
          '{}'::jsonb
        ) || $6::jsonb,
        fecha = COALESCE(
          $7,
          fecha
        ),
        updated_at = NOW()
      WHERE id = $8
      RETURNING ${PEDIDO_COLUMNS}
      `,
      [
        req.body?.cliente !==
        undefined
          ? String(
              req.body.cliente
            ).trim()
          : null,

        req.body?.sector !==
        undefined
          ? String(
              req.body.sector
            ).trim()
          : null,

        req.body?.prioridad !==
        undefined
          ? String(
              req.body.prioridad
            ).trim()
          : null,

        req.body?.dias !==
        undefined
          ? normalizeDias(
              req.body.dias,
              0
            )
          : null,

        bodyEstados
          ? JSON.stringify(
              bodyEstados
            )
          : null,

        JSON.stringify(
          bodyExtras
        ),

        req.body?.fecha !==
        undefined
          ? req.body.fecha
          : null,

        id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        message: "Pedido no encontrado",
      });
    }

    return res.json(
      mapPedido(result.rows[0])
    );
  } catch (error) {
    return sendDatabaseError(
      res,
      error,
      "Error al actualizar parcialmente pedido"
    );
  }
}

export async function deletePedido(
  req,
  res
) {
  const id = parsePedidoId(req.params.id);

  if (!id) {
    return res.status(400).json({
      ok: false,
      message: "ID inválido",
    });
  }

  try {
    const canceladoAt =
      new Date().toISOString();

    const result = await pool.query(
      `
      UPDATE pedidos
      SET
        estados = CASE
          WHEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(estados) = 'array'
                  THEN estados
                ELSE '[]'::jsonb
              END
            ) AS item
            WHERE UPPER(
              COALESCE(
                item->>'estado',
                item #>> '{}',
                ''
              )
            ) = 'CANCELADO'
          )
            THEN estados
          ELSE
            CASE
              WHEN jsonb_typeof(estados) = 'array'
                THEN estados
              ELSE '[]'::jsonb
            END
            ||
            jsonb_build_array(
              jsonb_build_object(
                'estado',
                'CANCELADO',
                'at',
                $1::text
              )
            )
        END,
        extras = COALESCE(
          extras,
          '{}'::jsonb
        ) || jsonb_build_object(
          'cancelado',
          true,
          'canceladoAt',
          $1::text
        ),
        updated_at = NOW()
      WHERE id = $2
      RETURNING ${PEDIDO_COLUMNS}
      `,
      [canceladoAt, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        message: "Pedido no encontrado",
      });
    }

    return res.json({
      ok: true,
      pedido: mapPedido(
        result.rows[0]
      ),
    });
  } catch (error) {
    return sendDatabaseError(
      res,
      error,
      "Error al cancelar pedido"
    );
  }
}
