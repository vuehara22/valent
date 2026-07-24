import { Router } from "express";
import multer from "multer";
import { pool } from "../config/db.js";
import { emitPedidoActualizado } from "../realtime.js";

const router = Router();

const uploadArchivoPedido = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

const CAMPOS_PESADOS = new Set([
  "dataUrl",
  "data_url",
  "base64",
  "contenido",
  "buffer",
  "fileData",
  "file_data",
  "bytes",
  "binary",
]);

function limpiarDatosPesados(value) {
  if (Array.isArray(value)) {
    return value.map(limpiarDatosPesados);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !CAMPOS_PESADOS.has(key))
        .map(([key, childValue]) => [
          key,
          limpiarDatosPesados(childValue),
        ])
    );
  }

  return value;
}

function mapPedido(row, { limpiarExtras = false } = {}) {
  const extras = row.extras || {};

  return {
    id: row.id,
    cliente: row.cliente,
    sector: row.sector,
    prioridad: row.prioridad,
    dias: row.dias,
    estados: row.estados || ["PENDIENTE"],
    extras: limpiarExtras
      ? limpiarDatosPesados(extras)
      : extras,
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
    estados:
      Array.isArray(body.estados) &&
      body.estados.length > 0
        ? body.estados
        : ["PENDIENTE"],
    extras:
      body.extras &&
      typeof body.extras === "object"
        ? body.extras
        : {},
    fecha: body.fecha || new Date().toISOString(),
  };
}

function emitirCambioPedido(tipo, pedidoOrPayload) {
  emitPedidoActualizado({
    tipo,
    pedidoId:
      pedidoOrPayload?.id ||
      pedidoOrPayload?.pedidoId ||
      null,
    sector: pedidoOrPayload?.sector || null,
  });
}

function responderErrorBase(res, error, mensaje) {
  const temporalCodes = new Set([
    "57P03",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ECONNRESET",
  ]);

  if (temporalCodes.has(error?.code)) {
    return res.status(503).json({
      message:
        "La base de datos se está recuperando. Reintentá en unos segundos.",
    });
  }

  return res.status(500).json({
    message: mensaje,
  });
}

/* =========================================================
   LISTAR PEDIDOS
========================================================= */

router.get("/", async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit);

    const limit = Number.isFinite(requestedLimit)
      ? Math.min(
          Math.max(requestedLimit, 1),
          100
        )
      : 50;

    const result = await pool.query(
      `
      SELECT
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
      FROM pedidos
      ORDER BY fecha DESC, id DESC
      LIMIT $1
      `,
      [limit]
    );

    const pedidos = result.rows.map((row) =>
      mapPedido(row, {
        limpiarExtras: true,
      })
    );

    return res.json(pedidos);
  } catch (error) {
    console.error("Error GET /api/pedidos:", {
      message: error?.message,
      code: error?.code,
    });

    return responderErrorBase(
      res,
      error,
      "Error al obtener pedidos"
    );
  }
});

/* =========================================================
   LISTAR ARCHIVOS DE UN PEDIDO
========================================================= */

router.get("/:id/archivos", async (req, res) => {
  try {
    const pedidoId = Number(req.params.id);

    if (!Number.isFinite(pedidoId)) {
      return res.status(400).json({
        ok: false,
        message: "ID inválido",
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        pedido_id,
        tipo,
        tag,
        nombre,
        mime_type,
        size_bytes,
        ruta,
        created_at
      FROM archivos_pedido
      WHERE pedido_id = $1
      ORDER BY created_at DESC, id DESC
      `,
      [pedidoId]
    );

    return res.json({
      ok: true,
      archivos: result.rows,
    });
  } catch (error) {
    console.error(
      "Error GET /api/pedidos/:id/archivos:",
      {
        message: error?.message,
        code: error?.code,
      }
    );

    return responderErrorBase(
      res,
      error,
      "Error al obtener archivos del pedido"
    );
  }
});

/* =========================================================
   SUBIR ARCHIVO A UN PEDIDO
========================================================= */

router.post(
  "/:id/archivos",
  uploadArchivoPedido.single("file"),
  async (req, res) => {
    try {
      const pedidoId = Number(req.params.id);

      if (!Number.isFinite(pedidoId)) {
        return res.status(400).json({
          ok: false,
          message: "ID inválido",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          ok: false,
          message: "No se recibió archivo",
        });
      }

      const tipo = String(
        req.body.tipo || "GUIA"
      )
        .trim()
        .toUpperCase();

      const tag = String(
        req.body.tag || "LOGISTICA"
      )
        .trim()
        .toUpperCase();

      const pedidoExists = await pool.query(
        `
        SELECT
          id,
          sector
        FROM pedidos
        WHERE id = $1
        `,
        [pedidoId]
      );

      if (pedidoExists.rowCount === 0) {
        return res.status(404).json({
          ok: false,
          message: "Pedido no encontrado",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO archivos_pedido (
          pedido_id,
          tipo,
          tag,
          nombre,
          mime_type,
          size_bytes,
          ruta,
          contenido,
          created_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          NOW()
        )
        RETURNING
          id,
          pedido_id,
          tipo,
          tag,
          nombre,
          mime_type,
          size_bytes,
          ruta,
          created_at
        `,
        [
          pedidoId,
          tipo,
          tag,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
          `/api/pedidos/${pedidoId}/archivos/download`,
          req.file.buffer,
        ]
      );

      const archivo = result.rows[0];

      emitirCambioPedido("ARCHIVO_SUBIDO", {
        pedidoId,
        sector:
          pedidoExists.rows[0]?.sector ||
          null,
      });

      return res.status(201).json({
        ok: true,
        archivo: {
          id: String(archivo.id),
          pedidoId: archivo.pedido_id,
          tipo: archivo.tipo,
          tag: archivo.tag,
          nombre: archivo.nombre,
          mimeType: archivo.mime_type,
          size: archivo.size_bytes,
          fecha: archivo.created_at,
          url: `/api/pedidos/${pedidoId}/archivos/${archivo.id}/download`,
        },
      });
    } catch (error) {
      console.error(
        "Error POST /api/pedidos/:id/archivos:",
        {
          message: error?.message,
          code: error?.code,
        }
      );

      return responderErrorBase(
        res,
        error,
        "Error al subir archivo del pedido"
      );
    }
  }
);

/* =========================================================
   DESCARGAR ARCHIVO
========================================================= */

router.get(
  "/:id/archivos/:archivoId/download",
  async (req, res) => {
    try {
      const pedidoId = Number(req.params.id);

      const archivoId = Number(
        req.params.archivoId
      );

      if (
        !Number.isFinite(pedidoId) ||
        !Number.isFinite(archivoId)
      ) {
        return res.status(400).json({
          ok: false,
          message: "ID inválido",
        });
      }

      const result = await pool.query(
        `
        SELECT
          id,
          pedido_id,
          nombre,
          mime_type,
          contenido
        FROM archivos_pedido
        WHERE id = $1
          AND pedido_id = $2
        `,
        [archivoId, pedidoId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          ok: false,
          message: "Archivo no encontrado",
        });
      }

      const archivo = result.rows[0];

      if (!archivo.contenido) {
        return res.status(404).json({
          ok: false,
          message:
            "El archivo no tiene contenido guardado",
        });
      }

      res.setHeader(
        "Content-Type",
        archivo.mime_type ||
          "application/octet-stream"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(
          archivo.nombre
        )}"`
      );

      return res.send(archivo.contenido);
    } catch (error) {
      console.error(
        "Error DOWNLOAD /api/pedidos/:id/archivos/:archivoId:",
        {
          message: error?.message,
          code: error?.code,
        }
      );

      return responderErrorBase(
        res,
        error,
        "Error al descargar archivo"
      );
    }
  }
);

/* =========================================================
   ELIMINAR ARCHIVO
========================================================= */

router.delete(
  "/:id/archivos/:archivoId",
  async (req, res) => {
    try {
      const pedidoId = Number(req.params.id);

      const archivoId = Number(
        req.params.archivoId
      );

      if (
        !Number.isFinite(pedidoId) ||
        !Number.isFinite(archivoId)
      ) {
        return res.status(400).json({
          ok: false,
          message: "ID inválido",
        });
      }

      const pedidoExists = await pool.query(
        `
        SELECT
          id,
          sector
        FROM pedidos
        WHERE id = $1
        `,
        [pedidoId]
      );

      const result = await pool.query(
        `
        DELETE FROM archivos_pedido
        WHERE id = $1
          AND pedido_id = $2
        RETURNING id
        `,
        [archivoId, pedidoId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          ok: false,
          message: "Archivo no encontrado",
        });
      }

      emitirCambioPedido(
        "ARCHIVO_ELIMINADO",
        {
          pedidoId,
          sector:
            pedidoExists.rows[0]?.sector ||
            null,
        }
      );

      return res.json({
        ok: true,
        deletedId: archivoId,
      });
    } catch (error) {
      console.error(
        "Error DELETE /api/pedidos/:id/archivos/:archivoId:",
        {
          message: error?.message,
          code: error?.code,
        }
      );

      return responderErrorBase(
        res,
        error,
        "Error al eliminar archivo"
      );
    }
  }
);

/* =========================================================
   OBTENER UN PEDIDO
========================================================= */

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({
        message: "ID inválido",
      });
    }

    const result = await pool.query(
      `
      SELECT
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
      FROM pedidos
      WHERE id = $1
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Pedido no encontrado",
      });
    }

    return res.json(
      mapPedido(result.rows[0])
    );
  } catch (error) {
    console.error(
      "Error GET /api/pedidos/:id:",
      {
        message: error?.message,
        code: error?.code,
      }
    );

    return responderErrorBase(
      res,
      error,
      "Error al obtener pedido"
    );
  }
});

/* =========================================================
   CREAR PEDIDO
========================================================= */

router.post("/", async (req, res) => {
  try {
    const pedido = normalizePedidoBody(
      req.body
    );

    if (!pedido.cliente) {
      return res.status(400).json({
        message:
          "El cliente es obligatorio",
      });
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
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        $6::jsonb,
        $7
      )
      RETURNING
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

    const pedidoCreado = mapPedido(
      result.rows[0]
    );

    emitirCambioPedido(
      "CREADO",
      pedidoCreado
    );

    return res
      .status(201)
      .json(pedidoCreado);
  } catch (error) {
    console.error(
      "Error POST /api/pedidos:",
      {
        message: error?.message,
        code: error?.code,
      }
    );

    return responderErrorBase(
      res,
      error,
      "Error al crear pedido"
    );
  }
});

/* =========================================================
   ACTUALIZAR PEDIDO COMPLETO
========================================================= */

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({
        message: "ID inválido",
      });
    }

    const pedido = normalizePedidoBody(
      req.body
    );

    if (!pedido.cliente) {
      return res.status(400).json({
        message:
          "El cliente es obligatorio",
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
      RETURNING
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
        id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Pedido no encontrado",
      });
    }

    const pedidoActualizado = mapPedido(
      result.rows[0]
    );

    emitirCambioPedido(
      "ACTUALIZADO",
      pedidoActualizado
    );

    return res.json(
      pedidoActualizado
    );
  } catch (error) {
    console.error(
      "Error PUT /api/pedidos/:id:",
      {
        message: error?.message,
        code: error?.code,
      }
    );

    return responderErrorBase(
      res,
      error,
      "Error al actualizar pedido"
    );
  }
});

/* =========================================================
   ACTUALIZAR ESTADOS Y EXTRAS
========================================================= */

router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({
        message: "ID inválido",
      });
    }

    const currentResult =
      await pool.query(
        `
        SELECT
          estados,
          extras
        FROM pedidos
        WHERE id = $1
        `,
        [id]
      );

    if (
      currentResult.rowCount === 0
    ) {
      return res.status(404).json({
        message:
          "Pedido no encontrado",
      });
    }

    const current =
      currentResult.rows[0];

    const nextExtras =
      req.body?.extras &&
      typeof req.body.extras ===
        "object"
        ? {
            ...(current.extras ||
              {}),
            ...req.body.extras,
          }
        : current.extras || {};

    const nextEstados =
      Array.isArray(
        req.body.estados
      ) &&
      req.body.estados.length > 0
        ? req.body.estados
        : current.estados || [
            "PENDIENTE",
          ];

    const result = await pool.query(
      `
      UPDATE pedidos
      SET
        estados = $1::jsonb,
        extras = $2::jsonb,
        updated_at = NOW()
      WHERE id = $3
      RETURNING
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
      `,
      [
        JSON.stringify(
          nextEstados
        ),
        JSON.stringify(nextExtras),
        id,
      ]
    );

    const pedidoActualizado = mapPedido(
      result.rows[0]
    );

    emitirCambioPedido(
      "PATCH",
      pedidoActualizado
    );

    return res.json(
      pedidoActualizado
    );
  } catch (error) {
    console.error(
      "Error PATCH /api/pedidos/:id:",
      {
        message: error?.message,
        code: error?.code,
      }
    );

    return responderErrorBase(
      res,
      error,
      "Error actualizando pedido"
    );
  }
});

/* =========================================================
   CANCELAR PEDIDO
========================================================= */

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({
        message: "ID inválido",
      });
    }

    const result = await pool.query(
      `
      UPDATE pedidos
      SET
        estados =
          COALESCE(
            estados,
            '[]'::jsonb
          )
          || '["CANCELADO"]'::jsonb,
        extras = jsonb_set(
          COALESCE(
            extras,
            '{}'::jsonb
          ),
          '{canceladoAt}',
          to_jsonb(NOW()::text),
          true
        ),
        updated_at = NOW()
      WHERE id = $1
      RETURNING
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
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message:
          "Pedido no encontrado",
      });
    }

    const pedidoCancelado = mapPedido(
      result.rows[0]
    );

    emitirCambioPedido(
      "CANCELADO",
      pedidoCancelado
    );

    return res.json({
      ok: true,
      pedido: pedidoCancelado,
    });
  } catch (error) {
    console.error(
      "Error DELETE /api/pedidos/:id:",
      {
        message: error?.message,
        code: error?.code,
      }
    );

    return responderErrorBase(
      res,
      error,
      "Error al cancelar pedido"
    );
  }
});

export default router;