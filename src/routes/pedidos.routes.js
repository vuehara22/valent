import { Router } from "express";
import { pool } from "../config/db.js";
import multer from "multer";

const router = Router();

const uploadArchivoPedido = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

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
    estados:
      Array.isArray(body.estados) && body.estados.length > 0
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


router.get("/:id/archivos", async (req, res) => {
  try {
    const pedidoId = Number(req.params.id);

    if (!Number.isFinite(pedidoId)) {
      return res.status(400).json({ ok: false, message: "ID inválido" });
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

    res.json({
      ok: true,
      archivos: result.rows,
    });
  } catch (error) {
    console.error("Error GET /api/pedidos/:id/archivos:", error);
    res.status(500).json({
      ok: false,
      message: "Error al obtener archivos del pedido",
    });
  }
});

router.post(
  "/:id/archivos",
  uploadArchivoPedido.single("file"),
  async (req, res) => {
    try {
      const pedidoId = Number(req.params.id);

      if (!Number.isFinite(pedidoId)) {
        return res.status(400).json({ ok: false, message: "ID inválido" });
      }

      if (!req.file) {
        return res.status(400).json({
          ok: false,
          message: "No se recibió archivo",
        });
      }

      const tipo = String(req.body.tipo || "GUIA").trim().toUpperCase();
      const tag = String(req.body.tag || "LOGISTICA").trim().toUpperCase();

      const pedidoExists = await pool.query(
        `
        SELECT id
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
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

res.status(201).json({
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
      console.error("Error POST /api/pedidos/:id/archivos:", error);
      res.status(500).json({
        ok: false,
        message: "Error al subir archivo del pedido",
      });
    }
  }
);

router.get("/:id/archivos/:archivoId/download", async (req, res) => {
  try {
    const pedidoId = Number(req.params.id);
    const archivoId = Number(req.params.archivoId);

    if (!Number.isFinite(pedidoId) || !Number.isFinite(archivoId)) {
      return res.status(400).json({ ok: false, message: "ID inválido" });
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
        message: "El archivo no tiene contenido guardado",
      });
    }

    res.setHeader(
      "Content-Type",
      archivo.mime_type || "application/octet-stream"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(archivo.nombre)}"`
    );

    res.send(archivo.contenido);
  } catch (error) {
    console.error("Error DOWNLOAD /api/pedidos/:id/archivos/:archivoId:", error);
    res.status(500).json({
      ok: false,
      message: "Error al descargar archivo",
    });
  }
});

router.delete("/:id/archivos/:archivoId", async (req, res) => {
  try {
    const pedidoId = Number(req.params.id);
    const archivoId = Number(req.params.archivoId);

    if (!Number.isFinite(pedidoId) || !Number.isFinite(archivoId)) {
      return res.status(400).json({ ok: false, message: "ID inválido" });
    }

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

    res.json({
      ok: true,
      deletedId: archivoId,
    });
  } catch (error) {
    console.error("Error DELETE /api/pedidos/:id/archivos/:archivoId:", error);
    res.status(500).json({
      ok: false,
      message: "Error al eliminar archivo",
    });
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

router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "ID inválido" });
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
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    const current = currentResult.rows[0];

    const nextExtras =
      req.body?.extras && typeof req.body.extras === "object"
        ? req.body.extras
        : current.extras || {};

    const result = await pool.query(
      `
      UPDATE pedidos
      SET
        extras = $1::jsonb,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [JSON.stringify(nextExtras), id]
    );

    res.json(mapPedido(result.rows[0]));
  } catch (error) {
    console.error("Error PATCH /api/pedidos/:id:", error);
    res.status(500).json({
      message: "Error actualizando extras del pedido",
    });
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
      UPDATE pedidos
      SET
        estados = COALESCE(estados, '[]'::jsonb) || '["CANCELADO"]'::jsonb,
        extras = jsonb_set(
          COALESCE(extras, '{}'::jsonb),
          '{canceladoAt}',
          to_jsonb(NOW()::text),
          true
        ),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Pedido no encontrado" });
    }

    res.json({ ok: true, pedido: mapPedido(result.rows[0]) });
  } catch (error) {
    console.error("Error DELETE /api/pedidos/:id:", error);
    res.status(500).json({ message: "Error al cancelar pedido" });
  }
});

export default router;