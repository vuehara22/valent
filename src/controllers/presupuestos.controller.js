import { pool } from "../config/db.js";

const DEFAULT_NOTA_ENVIO = {
  optica: "",
  recibe: "",
  domicilio: "",
  localidad: "",
  telefono: "",
  cuitDni: "",
  horario: "",
};

function safeObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : fallback;
    } catch {
      return fallback;
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeSector(value) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "");

  if (raw === "cuero" || raw === "cueros") return "cuero";
  if (raw === "estampa" || raw === "estampas") return "estampa";
  if (raw === "plastico" || raw === "plasticos") return "plastico";
  if (raw === "liquido" || raw === "liquidos") return "liquidos";
  if (raw === "embalaje") return "embalaje";
  if (raw === "logistica") return "logistica";
  return "plastico";
}

function uniqueSectores(value, fallbackSector = "plastico") {
  const values = safeArray(value).map(normalizeSector).filter(Boolean);
  if (!values.length) values.push(normalizeSector(fallbackSector));
  return [...new Set(values)];
}

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNotaEnvio(value, fallback = {}) {
  const nota = safeObject(value, {});
  return {
    ...DEFAULT_NOTA_ENVIO,
    ...fallback,
    ...nota,
  };
}

function mapPresupuesto(row) {
  return {
    id: row.id,
    version: Number(row.version) || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    estado: row.estado,
    aprobado: Boolean(row.aprobado),
    aprobadoAt: row.aprobado_at,
    pedidoGeneradoId: row.pedido_generado_id,
    pedido_generado_id: row.pedido_generado_id,

    clienteId: row.cliente_id,
    cliente_id: row.cliente_id,
    cliente: row.cliente,
    sector: row.sector,
    sectoresAsignados: safeArray(row.sectores_asignados),
    sectores_asignados: safeArray(row.sectores_asignados),
    prioridad: row.prioridad,
    dias: Number(row.dias) || 0,

    numero: row.numero || "",
    remitoNro: row.numero || "",
    remito_nro: row.numero || "",
    fecha: row.fecha || "",
    validez: row.validez || "",
    cuit: row.cuit || "",
    domicilio: row.domicilio || "",
    ubicacion: row.ubicacion || "",
    telefono: row.telefono || "",
    condVenta: row.cond_venta || "",
    cond_venta: row.cond_venta || "",
    condIva: row.cond_iva || "",
    cond_iva: row.cond_iva || "",

    detalle: row.detalle || "",
    items: safeArray(row.items),
    totals: safeObject(row.totals, { subtotal: 0, iva: 0, total: 0 }),
    notaEnvio: normalizeNotaEnvio(row.nota_envio),
    nota_envio: normalizeNotaEnvio(row.nota_envio),
  };
}

function getProductoId(item) {
  const raw =
    item?.productoIdManual ??
    item?.productoId ??
    item?.producto_id ??
    item?.idProducto ??
    item?.productId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getCantidad(item) {
  return Math.max(0, numberOr(item?.cantidad ?? item?.qty ?? item?.unidades, 0));
}

function getStockMap(items) {
  const result = new Map();
  for (const item of safeArray(items)) {
    if (item?.descontarStock === false) continue;
    const productoId = getProductoId(item);
    const cantidad = getCantidad(item);
    if (!productoId || cantidad <= 0) continue;
    result.set(productoId, (result.get(productoId) || 0) + cantidad);
  }
  return result;
}

async function aplicarDiferenciaStock(client, itemsAnteriores, itemsNuevos) {
  const anterior = getStockMap(itemsAnteriores);
  const nuevo = getStockMap(itemsNuevos);
  const ids = [...new Set([...anterior.keys(), ...nuevo.keys()])];

  for (const productoId of ids) {
    const cantidadAnterior = anterior.get(productoId) || 0;
    const cantidadNueva = nuevo.get(productoId) || 0;
    const diferencia = cantidadAnterior - cantidadNueva;
    if (diferencia === 0) continue;

    await client.query(
      `
      UPDATE productos
      SET stock = GREATEST(0, COALESCE(stock, 0) + $1),
          updated_at = NOW()
      WHERE id = $2
      `,
      [diferencia, productoId]
    );
  }
}

function mergeSectoresEstado(extrasActuales, sectoresNuevos) {
  const anteriores = safeObject(extrasActuales?.sectoresEstado, {});
  const next = {};

  for (const sector of sectoresNuevos) {
    const key = Object.keys(anteriores).find(
      (candidate) => normalizeSector(candidate) === sector
    );
    next[sector] = key ? anteriores[key] : "PENDIENTE";
  }

  return next;
}

function buildPresupuestoExtras(row, body, notaEnvio) {
  return {
    id: row.id,
    numero: body.numero ?? body.remitoNro ?? row.numero ?? "",
    fecha: body.fecha ?? row.fecha ?? "",
    validez: body.validez ?? row.validez ?? "",
    cuit: body.cuit ?? row.cuit ?? "",
    domicilio: body.domicilio ?? row.domicilio ?? "",
    ubicacion: body.ubicacion ?? row.ubicacion ?? "",
    telefono: body.telefono ?? row.telefono ?? "",
    condVenta: body.condVenta ?? body.cond_venta ?? row.cond_venta ?? "",
    condIva: body.condIva ?? body.cond_iva ?? row.cond_iva ?? "",
    detalle: body.detalle ?? row.detalle ?? "",
    cliente: body.cliente ?? row.cliente ?? "",
    estado: row.aprobado ? "APROBADO" : body.estado ?? row.estado ?? "BORRADOR",
    items: safeArray(body.items ?? row.items),
    totals: safeObject(body.totals ?? row.totals, {
      subtotal: 0,
      iva: 0,
      total: 0,
    }),
    notaEnvio,
  };
}

async function sincronizarPedidoAprobado(client, rowAnterior, rowActualizado, body) {
  const pedidoId = Number(rowAnterior.pedido_generado_id);
  if (!rowAnterior.aprobado || !Number.isInteger(pedidoId) || pedidoId <= 0) return;

  const pedidoResult = await client.query(
    `SELECT * FROM pedidos WHERE id = $1 FOR UPDATE`,
    [pedidoId]
  );
  if (!pedidoResult.rows.length) return;

  const pedido = pedidoResult.rows[0];
  const extrasActuales = safeObject(pedido.extras, {});
  const sectores = uniqueSectores(
    body.sectoresAsignados ?? body.sectores_asignados ?? rowActualizado.sectores_asignados,
    body.sector ?? rowActualizado.sector
  );
  const notaEnvio = normalizeNotaEnvio(
    body.notaEnvio ?? body.nota_envio ?? rowActualizado.nota_envio,
    {
      optica: body.cliente ?? rowActualizado.cliente ?? "",
      domicilio: body.domicilio ?? rowActualizado.domicilio ?? "",
      localidad: body.ubicacion ?? rowActualizado.ubicacion ?? "",
      telefono: body.telefono ?? rowActualizado.telefono ?? "",
      cuitDni: body.cuit ?? rowActualizado.cuit ?? "",
    }
  );

  const extrasNuevos = {
    ...extrasActuales,
    origen: "PRESUPUESTO",
    presupuestoId: rowActualizado.id,
    clienteId: body.clienteId ?? body.cliente_id ?? rowActualizado.cliente_id ?? null,
    sectoresAsignados: sectores,
    sectoresEstado: mergeSectoresEstado(extrasActuales, sectores),
    notaEnvio,
    presupuesto: buildPresupuestoExtras(rowActualizado, body, notaEnvio),
    presupuestoModificadoAt: new Date().toISOString(),
  };

  await client.query(
    `
    UPDATE pedidos
    SET cliente = $1,
        sector = $2,
        prioridad = $3,
        dias = $4,
        extras = $5::jsonb,
        updated_at = NOW()
    WHERE id = $6
    `,
    [
      body.cliente ?? rowActualizado.cliente ?? pedido.cliente,
      sectores[0] ?? body.sector ?? rowActualizado.sector ?? pedido.sector,
      body.prioridad ?? rowActualizado.prioridad ?? pedido.prioridad ?? "OK",
      Math.max(0, Math.trunc(numberOr(body.dias ?? rowActualizado.dias, 0))),
      JSON.stringify(extrasNuevos),
      pedidoId,
    ]
  );
}

function presupuestoValues(p, existing = null) {
  const aprobadoExistente = Boolean(existing?.aprobado);
  const pedidoExistente = existing?.pedido_generado_id ?? null;
  const estadoExistente = existing?.estado ?? "BORRADOR";

  return {
    version: Math.max(1, Math.trunc(numberOr(p.version, Number(existing?.version) || 1))),
    estado: aprobadoExistente ? "APROBADO" : String(p.estado || estadoExistente || "BORRADOR").toUpperCase(),
    aprobado: aprobadoExistente ? true : Boolean(p.aprobado),
    aprobadoAt: aprobadoExistente
      ? existing?.aprobado_at
      : p.aprobadoAt ?? p.aprobado_at ?? null,
    pedidoGeneradoId: aprobadoExistente
      ? pedidoExistente
      : p.pedidoGeneradoId ?? p.pedido_generado_id ?? pedidoExistente,
    clienteId: p.clienteId ?? p.cliente_id ?? existing?.cliente_id ?? null,
    cliente: String(p.cliente ?? existing?.cliente ?? "Sin cliente").trim() || "Sin cliente",
    sector: normalizeSector(p.sector ?? existing?.sector ?? "plastico"),
    sectoresAsignados: uniqueSectores(
      p.sectoresAsignados ?? p.sectores_asignados ?? existing?.sectores_asignados,
      p.sector ?? existing?.sector
    ),
    prioridad: String(p.prioridad ?? existing?.prioridad ?? "OK").trim() || "OK",
    dias: Math.max(0, Math.trunc(numberOr(p.dias, Number(existing?.dias) || 0))),
    numero: String(p.numero ?? p.remitoNro ?? p.remito_nro ?? existing?.numero ?? "").trim(),
    fecha: String(p.fecha ?? existing?.fecha ?? ""),
    validez: String(p.validez ?? existing?.validez ?? ""),
    cuit: String(p.cuit ?? existing?.cuit ?? ""),
    domicilio: String(p.domicilio ?? existing?.domicilio ?? ""),
    ubicacion: String(p.ubicacion ?? existing?.ubicacion ?? ""),
    telefono: String(p.telefono ?? existing?.telefono ?? ""),
    condVenta: String(p.condVenta ?? p.cond_venta ?? existing?.cond_venta ?? ""),
    condIva: String(p.condIva ?? p.cond_iva ?? existing?.cond_iva ?? ""),
    detalle: String(p.detalle ?? existing?.detalle ?? ""),
    items: safeArray(p.items ?? existing?.items),
    totals: safeObject(p.totals ?? existing?.totals, { subtotal: 0, iva: 0, total: 0 }),
    notaEnvio: normalizeNotaEnvio(p.notaEnvio ?? p.nota_envio ?? existing?.nota_envio),
  };
}

export async function getPresupuestos(_req, res) {
  try {
    const result = await pool.query(`SELECT * FROM presupuestos ORDER BY updated_at DESC`);
    return res.json(result.rows.map(mapPresupuesto));
  } catch (error) {
    console.error("Error al obtener presupuestos:", error);
    return res.status(500).json({ error: "Error al obtener presupuestos" });
  }
}

export async function getPresupuestoById(req, res) {
  try {
    const result = await pool.query(`SELECT * FROM presupuestos WHERE id = $1`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Presupuesto no encontrado" });
    return res.json(mapPresupuesto(result.rows[0]));
  } catch (error) {
    console.error("Error al obtener presupuesto:", error);
    return res.status(500).json({ error: "Error al obtener presupuesto" });
  }
}

export async function crearPresupuesto(req, res) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const p = req.body || {};
    const id = String(p.id || `pres-${Date.now()}-${Math.random().toString(16).slice(2)}`);

    const existing = await client.query(`SELECT * FROM presupuestos WHERE id = $1 FOR UPDATE`, [id]);
    if (existing.rows.length) {
      await client.query("COMMIT");
      return res.status(200).json(mapPresupuesto(existing.rows[0]));
    }

    const v = presupuestoValues(p);
    const result = await client.query(
      `
      INSERT INTO presupuestos (
        id, version, created_at, updated_at, estado, aprobado, aprobado_at,
        pedido_generado_id, cliente_id, cliente, sector, sectores_asignados,
        prioridad, dias, numero, fecha, validez, cuit, domicilio, ubicacion,
        telefono, cond_venta, cond_iva, detalle, items, totals, nota_envio
      ) VALUES (
        $1,$2,NOW(),NOW(),$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,
        $15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24::jsonb,$25::jsonb
      ) RETURNING *
      `,
      [
        id, v.version, v.estado, v.aprobado, v.aprobadoAt, v.pedidoGeneradoId,
        v.clienteId, v.cliente, v.sector, JSON.stringify(v.sectoresAsignados),
        v.prioridad, v.dias, v.numero, v.fecha, v.validez, v.cuit, v.domicilio,
        v.ubicacion, v.telefono, v.condVenta, v.condIva, v.detalle,
        JSON.stringify(v.items), JSON.stringify(v.totals), JSON.stringify(v.notaEnvio),
      ]
    );
    await client.query("COMMIT");
    return res.status(201).json(mapPresupuesto(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al crear presupuesto:", error);
    return res.status(500).json({ error: "Error al crear presupuesto" });
  } finally {
    client.release();
  }
}

export async function actualizarPresupuesto(req, res) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { id } = req.params;
    const p = req.body || {};

    const oldResult = await client.query(`SELECT * FROM presupuestos WHERE id = $1 FOR UPDATE`, [id]);
    if (!oldResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Presupuesto no encontrado" });
    }

    const oldRow = oldResult.rows[0];
    const v = presupuestoValues(p, oldRow);

    if (oldRow.aprobado) {
      await aplicarDiferenciaStock(client, oldRow.items, v.items);
    }

    const result = await client.query(
      `
      UPDATE presupuestos SET
        version = $1, updated_at = NOW(), estado = $2, aprobado = $3,
        aprobado_at = $4, pedido_generado_id = $5, cliente_id = $6,
        cliente = $7, sector = $8, sectores_asignados = $9::jsonb,
        prioridad = $10, dias = $11, numero = $12, fecha = $13,
        validez = $14, cuit = $15, domicilio = $16, ubicacion = $17,
        telefono = $18, cond_venta = $19, cond_iva = $20, detalle = $21,
        items = $22::jsonb, totals = $23::jsonb, nota_envio = $24::jsonb
      WHERE id = $25 RETURNING *
      `,
      [
        Math.max(v.version, Number(oldRow.version || 0) + 1), v.estado, v.aprobado,
        v.aprobadoAt, v.pedidoGeneradoId, v.clienteId, v.cliente, v.sector,
        JSON.stringify(v.sectoresAsignados), v.prioridad, v.dias, v.numero,
        v.fecha, v.validez, v.cuit, v.domicilio, v.ubicacion, v.telefono,
        v.condVenta, v.condIva, v.detalle, JSON.stringify(v.items),
        JSON.stringify(v.totals), JSON.stringify(v.notaEnvio), id,
      ]
    );

    const updatedRow = result.rows[0];
    await sincronizarPedidoAprobado(client, oldRow, updatedRow, p);
    await client.query("COMMIT");

    return res.json({
      ok: true,
      presupuesto: mapPresupuesto(updatedRow),
      pedidoActualizadoId: oldRow.aprobado ? oldRow.pedido_generado_id : null,
      stockActualizado: Boolean(oldRow.aprobado),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al actualizar presupuesto:", error);
    return res.status(500).json({ error: error?.message || "Error al actualizar presupuesto" });
  } finally {
    client.release();
  }
}

export async function aprobarPresupuesto(req, res) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { id } = req.params;
    const pres = await client.query(`SELECT * FROM presupuestos WHERE id = $1 FOR UPDATE`, [id]);
    if (!pres.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Presupuesto no encontrado" });
    }

    const p = pres.rows[0];
    if (p.aprobado && p.pedido_generado_id) {
      await client.query("COMMIT");
      return res.json(mapPresupuesto(p));
    }

    const existingPedido = await client.query(
      `SELECT * FROM pedidos WHERE extras->>'presupuestoId' = $1 OR extras->'presupuesto'->>'id' = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [String(id)]
    );

    let pedidoId;
    if (existingPedido.rows.length) {
      pedidoId = existingPedido.rows[0].id;
    } else {
      const sectores = uniqueSectores(p.sectores_asignados, p.sector);
      const notaEnvio = normalizeNotaEnvio(p.nota_envio, {
        optica: p.cliente || "",
        domicilio: p.domicilio || "",
        localidad: p.ubicacion || "",
        telefono: p.telefono || "",
        cuitDni: p.cuit || "",
      });
      const sectoresEstado = Object.fromEntries(sectores.map((sector) => [sector, "PENDIENTE"]));
      const now = new Date().toISOString();

      const pedidoInsert = await client.query(
        `
        INSERT INTO pedidos (cliente, sector, prioridad, dias, estados, extras, fecha, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,NOW(),NOW()) RETURNING *
        `,
        [
          p.cliente || "Sin cliente", sectores[0] || p.sector || "plastico",
          p.prioridad || "OK", Number(p.dias || 0),
          JSON.stringify([{ estado: "PENDIENTE", at: now }]),
          JSON.stringify({
            origen: "PRESUPUESTO", presupuestoId: p.id, clienteId: p.cliente_id || null,
            sectoresAsignados: sectores, sectoresEstado, notaEnvio,
            stockDescontado: true, stockDescontadoAt: now,
            presupuesto: buildPresupuestoExtras({ ...p, aprobado: true }, {}, notaEnvio),
          }),
          now,
        ]
      );
      pedidoId = pedidoInsert.rows[0].id;
    }

    await aplicarDiferenciaStock(client, [], p.items);

    const result = await client.query(
      `UPDATE presupuestos SET aprobado = TRUE, estado = 'APROBADO', aprobado_at = COALESCE(aprobado_at, NOW()), pedido_generado_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [pedidoId, id]
    );
    await client.query("COMMIT");
    return res.json(mapPresupuesto(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al aprobar presupuesto:", error);
    return res.status(500).json({ error: "Error al aprobar presupuesto" });
  } finally {
    client.release();
  }
}

export async function eliminarPresupuesto(req, res) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { id } = req.params;
    const pres = await client.query(`SELECT * FROM presupuestos WHERE id = $1 FOR UPDATE`, [id]);
    if (!pres.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Presupuesto no encontrado" });
    }

    const presupuesto = pres.rows[0];
    if (presupuesto.aprobado) {
      await aplicarDiferenciaStock(client, presupuesto.items, []);
    }

    if (presupuesto.pedido_generado_id) {
      const canceladoAt = new Date().toISOString();
      await client.query(
        `
        UPDATE pedidos SET
          estados = CASE WHEN jsonb_typeof(estados) = 'array' THEN estados ELSE '[]'::jsonb END || jsonb_build_array(jsonb_build_object('estado','CANCELADO','at',$1::text)),
          extras = COALESCE(extras, '{}'::jsonb) || jsonb_build_object('cancelado', true, 'canceladoAt', $1::text, 'canceladoPorPresupuestoId', $2::text),
          updated_at = NOW()
        WHERE id = $3
        `,
        [canceladoAt, id, presupuesto.pedido_generado_id]
      );
    }

    const result = await client.query(`DELETE FROM presupuestos WHERE id = $1 RETURNING *`, [id]);
    await client.query("COMMIT");
    return res.json({
      ok: true,
      presupuesto: mapPresupuesto(result.rows[0]),
      pedidoCanceladoId: presupuesto.pedido_generado_id || null,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al eliminar presupuesto:", error);
    return res.status(500).json({ error: "Error al eliminar presupuesto" });
  } finally {
    client.release();
  }
}
