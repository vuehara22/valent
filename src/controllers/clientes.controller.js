import { pool } from "../config/db.js";

function clean(value) {
  return String(value ?? "").trim();
}

function generarArchivoId() {
  return `archivo-cliente-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function normalizarTipoArchivo(value, nombre = "", mimeType = "") {
  const tipoRecibido = clean(value).toUpperCase();
  const nombreNormalizado = clean(nombre).toLowerCase();
  const mimeNormalizado = clean(mimeType).toLowerCase();

  if (tipoRecibido === "LOGO" || tipoRecibido === "DXF") {
    return tipoRecibido;
  }

  if (
    nombreNormalizado.endsWith(".dxf") ||
    mimeNormalizado.includes("dxf")
  ) {
    return "DXF";
  }

  if (mimeNormalizado.startsWith("image/")) {
    return "LOGO";
  }

  return "";
}

function normalizarArchivosCliente(value) {
  if (!value) {
    return [];
  }

  let archivos = value;

  if (typeof archivos === "string") {
    try {
      archivos = JSON.parse(archivos);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(archivos)) {
    return [];
  }

  const archivosNormalizados = [];
  const idsUsados = new Set();

  for (const archivo of archivos) {
    if (!archivo || typeof archivo !== "object") {
      continue;
    }

    const nombre = clean(archivo.nombre) || "archivo";
    const mimeType =
      clean(archivo.mimeType) || "application/octet-stream";

    const dataUrl = clean(
      archivo.dataUrl ||
        archivo.url ||
        archivo.href ||
        ""
    );

    if (!dataUrl) {
      continue;
    }

    const tipo = normalizarTipoArchivo(
      archivo.tipo,
      nombre,
      mimeType
    );

    if (tipo !== "LOGO" && tipo !== "DXF") {
      continue;
    }

    let id = clean(archivo.id) || generarArchivoId();

    while (idsUsados.has(id)) {
      id = generarArchivoId();
    }

    idsUsados.add(id);

    archivosNormalizados.push({
      id,
      nombre,
      tipo,
      mimeType,
      size: Math.max(0, Number(archivo.size) || 0),
      fecha: clean(archivo.fecha) || new Date().toISOString(),
      dataUrl,
    });
  }

  return archivosNormalizados;
}

function parseArchivosClienteDesdeDB(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return normalizarArchivosCliente(value);
  }

  if (typeof value === "object") {
    return normalizarArchivosCliente(value);
  }

  if (typeof value === "string") {
    try {
      return normalizarArchivosCliente(JSON.parse(value));
    } catch {
      return [];
    }
  }

  return [];
}

function mapCliente(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),

    nombre: row.nombre || "",
    direccion: row.direccion || "",
    localidad: row.localidad || "",
    telefono: row.telefono || "",
    condicionIVA: row.condicion_iva || "",
    cuit: row.cuit || "",

    direccionEnvio: row.direccion_envio || "",
    direccionFacturacion: row.direccion_facturacion || "",

    nombreApellido: row.nombre_apellido || "",
    dni: row.dni || "",
    email: row.email || "",
    expreso: row.expreso || "",

    notaEnvioOptica: row.nota_envio_optica || "",
    notaEnvioRecibe: row.nota_envio_recibe || "",
    notaEnvioDomicilio: row.nota_envio_domicilio || "",
    notaEnvioLocalidad: row.nota_envio_localidad || "",
    notaEnvioTelefono: row.nota_envio_telefono || "",
    notaEnvioCuitDni: row.nota_envio_cuit_dni || "",
    notaEnvioHorario: row.nota_envio_horario || "",

    archivosCliente: parseArchivosClienteDesdeDB(
      row.archivos_cliente
    ),

    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function obtenerArchivosDesdeBody(body) {
  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "archivosCliente"
    )
  ) {
    return {
      fueEnviado: true,
      archivos: normalizarArchivosCliente(
        body.archivosCliente
      ),
    };
  }

  if (
    Object.prototype.hasOwnProperty.call(
      body,
      "archivos_cliente"
    )
  ) {
    return {
      fueEnviado: true,
      archivos: normalizarArchivosCliente(
        body.archivos_cliente
      ),
    };
  }

  return {
    fueEnviado: false,
    archivos: [],
  };
}

async function existeClienteDuplicado({
  clienteId = null,
  nombre,
  cuit,
  dni,
  email,
}) {
  const result = await pool.query(
    `
    SELECT id, nombre, cuit, dni, email
    FROM clientes
    WHERE
      ($1::int IS NULL OR id <> $1)
      AND (
        LOWER(TRIM(nombre)) = LOWER(TRIM($2))
        OR (
          NULLIF(TRIM($3), '') IS NOT NULL
          AND REGEXP_REPLACE(COALESCE(cuit, ''), '\\D', '', 'g') =
              REGEXP_REPLACE($3, '\\D', '', 'g')
        )
        OR (
          NULLIF(TRIM($4), '') IS NOT NULL
          AND REGEXP_REPLACE(COALESCE(dni, ''), '\\D', '', 'g') =
              REGEXP_REPLACE($4, '\\D', '', 'g')
        )
        OR (
          NULLIF(TRIM($5), '') IS NOT NULL
          AND LOWER(TRIM(COALESCE(email, ''))) =
              LOWER(TRIM($5))
        )
      )
    LIMIT 1
    `,
    [
      clienteId,
      clean(nombre),
      clean(cuit),
      clean(dni),
      clean(email),
    ]
  );

  return result.rows[0] || null;
}

export async function getClientes(_req, res) {
  try {
    const result = await pool.query(`
      SELECT *
      FROM clientes
      ORDER BY nombre ASC, id ASC
    `);

    return res.json(
      result.rows
        .map(mapCliente)
        .filter(Boolean)
    );
  } catch (error) {
    console.error("Error al obtener clientes:", error);

    return res.status(500).json({
      error: "Error al obtener clientes",
      detalle:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
}

export async function getClientePorId(req, res) {
  try {
    const clienteId = Number(req.params.id);

    if (
      !Number.isInteger(clienteId) ||
      clienteId <= 0
    ) {
      return res.status(400).json({
        error: "ID de cliente inválido",
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM clientes
      WHERE id = $1
      LIMIT 1
      `,
      [clienteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Cliente no encontrado",
      });
    }

    return res.json(mapCliente(result.rows[0]));
  } catch (error) {
    console.error(
      "Error al obtener cliente por ID:",
      error
    );

    return res.status(500).json({
      error: "Error al obtener el cliente",
      detalle:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
}

export async function crearCliente(req, res) {
  try {
    const c = req.body ?? {};

    const nombre = clean(c.nombre);

    if (!nombre) {
      return res.status(400).json({
        error: "El nombre es obligatorio",
      });
    }

    const archivosRecibidos =
      obtenerArchivosDesdeBody(c);

    const archivosCliente =
      archivosRecibidos.archivos;

    const duplicado = await existeClienteDuplicado({
      nombre,
      cuit: c.cuit,
      dni: c.dni,
      email: c.email,
    });

    if (duplicado) {
      return res.status(409).json({
        error:
          "Ya existe un cliente con el mismo nombre, CUIT, DNI o email",
        clienteDuplicado: {
          id: Number(duplicado.id),
          nombre: duplicado.nombre || "",
        },
      });
    }

    const result = await pool.query(
      `
      INSERT INTO clientes (
        nombre,
        direccion,
        localidad,
        telefono,
        condicion_iva,
        cuit,
        direccion_envio,
        direccion_facturacion,
        nombre_apellido,
        dni,
        email,
        expreso,
        nota_envio_optica,
        nota_envio_recibe,
        nota_envio_domicilio,
        nota_envio_localidad,
        nota_envio_telefono,
        nota_envio_cuit_dni,
        nota_envio_horario,
        archivos_cliente
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
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20::jsonb
      )
      RETURNING *
      `,
      [
        nombre,
        clean(c.direccion),
        clean(c.localidad),
        clean(c.telefono),
        clean(c.condicionIVA),
        clean(c.cuit),

        clean(c.direccionEnvio),

        clean(c.direccionFacturacion),

        clean(c.nombreApellido),
        clean(c.dni),
        clean(c.email),
        clean(c.expreso),

        clean(
          c.notaEnvioOptica ||
            c.nombre
        ),

        clean(
          c.notaEnvioRecibe ||
            c.nombreApellido ||
            c.nombre
        ),

        clean(
          c.notaEnvioDomicilio ||
            c.direccionEnvio ||
            c.direccion
        ),

        clean(
          c.notaEnvioLocalidad ||
            c.localidad
        ),

        clean(
          c.notaEnvioTelefono ||
            c.telefono
        ),

        clean(
          c.notaEnvioCuitDni ||
            c.cuit ||
            c.dni
        ),

        clean(c.notaEnvioHorario),

        JSON.stringify(archivosCliente),
      ]
    );

    return res
      .status(201)
      .json(mapCliente(result.rows[0]));
  } catch (error) {
    console.error("Error al crear cliente:", error);

    return res.status(500).json({
      error: "Error al crear cliente",
      detalle:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
}

export async function actualizarCliente(req, res) {
  const client = await pool.connect();

  try {
    const clienteId = Number(req.params.id);
    const c = req.body ?? {};

    if (
      !Number.isInteger(clienteId) ||
      clienteId <= 0
    ) {
      return res.status(400).json({
        error: "ID de cliente inválido",
      });
    }

    const nombre = clean(c.nombre);

    if (!nombre) {
      return res.status(400).json({
        error: "El nombre es obligatorio",
      });
    }

    await client.query("BEGIN");

    const clienteActualResult = await client.query(
      `
      SELECT *
      FROM clientes
      WHERE id = $1
      FOR UPDATE
      `,
      [clienteId]
    );

    if (clienteActualResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Cliente no encontrado",
      });
    }

    const duplicado = await existeClienteDuplicado({
      clienteId,
      nombre,
      cuit: c.cuit,
      dni: c.dni,
      email: c.email,
    });

    if (duplicado) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error:
          "Ya existe otro cliente con el mismo nombre, CUIT, DNI o email",
        clienteDuplicado: {
          id: Number(duplicado.id),
          nombre: duplicado.nombre || "",
        },
      });
    }

    const archivosRecibidos =
      obtenerArchivosDesdeBody(c);

    const archivosActuales =
      parseArchivosClienteDesdeDB(
        clienteActualResult.rows[0].archivos_cliente
      );

    /*
     * Cuando el frontend envía archivosCliente,
     * se guarda exactamente ese array.
     *
     * Esto permite:
     * - agregar varios logos;
     * - agregar varios DXF;
     * - eliminar archivos individualmente;
     * - conservar todos los archivos restantes.
     *
     * Si el frontend no envía archivosCliente,
     * se mantienen los archivos existentes.
     */
    const archivosCliente =
      archivosRecibidos.fueEnviado
        ? archivosRecibidos.archivos
        : archivosActuales;

    const result = await client.query(
      `
      UPDATE clientes
      SET
        nombre = $1,
        direccion = $2,
        localidad = $3,
        telefono = $4,
        condicion_iva = $5,
        cuit = $6,
        direccion_envio = $7,
        direccion_facturacion = $8,
        nombre_apellido = $9,
        dni = $10,
        email = $11,
        expreso = $12,
        nota_envio_optica = $13,
        nota_envio_recibe = $14,
        nota_envio_domicilio = $15,
        nota_envio_localidad = $16,
        nota_envio_telefono = $17,
        nota_envio_cuit_dni = $18,
        nota_envio_horario = $19,
        archivos_cliente = $20::jsonb,
        updated_at = NOW()
      WHERE id = $21
      RETURNING *
      `,
      [
        nombre,
        clean(c.direccion),
        clean(c.localidad),
        clean(c.telefono),
        clean(c.condicionIVA),
        clean(c.cuit),

        clean(c.direccionEnvio),

        clean(c.direccionFacturacion),

        clean(c.nombreApellido),
        clean(c.dni),
        clean(c.email),
        clean(c.expreso),

        clean(
          c.notaEnvioOptica ||
            c.nombre
        ),

        clean(
          c.notaEnvioRecibe ||
            c.nombreApellido ||
            c.nombre
        ),

        clean(
          c.notaEnvioDomicilio ||
            c.direccionEnvio ||
            c.direccion
        ),

        clean(
          c.notaEnvioLocalidad ||
            c.localidad
        ),

        clean(
          c.notaEnvioTelefono ||
            c.telefono
        ),

        clean(
          c.notaEnvioCuitDni ||
            c.cuit ||
            c.dni
        ),

        clean(c.notaEnvioHorario),

        JSON.stringify(archivosCliente),

        clienteId,
      ]
    );

    await client.query("COMMIT");

    return res.json(mapCliente(result.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error(
      "Error al actualizar cliente:",
      error
    );

    return res.status(500).json({
      error: "Error al actualizar cliente",
      detalle:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  } finally {
    client.release();
  }
}

export async function eliminarCliente(req, res) {
  try {
    const clienteId = Number(req.params.id);

    if (
      !Number.isInteger(clienteId) ||
      clienteId <= 0
    ) {
      return res.status(400).json({
        error: "ID de cliente inválido",
      });
    }

    const pedidosResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM pedidos
      WHERE
        CASE
          WHEN jsonb_typeof(extras) = 'object'
          THEN COALESCE(
            NULLIF(extras->>'clienteId', ''),
            NULLIF(extras->>'cliente_id', '')
          )
          ELSE NULL
        END = $1::text
      `,
      [clienteId]
    ).catch(() => ({
      rows: [{ total: 0 }],
    }));

    const pedidosAsociados = Number(
      pedidosResult.rows[0]?.total || 0
    );

    if (pedidosAsociados > 0) {
      return res.status(409).json({
        error:
          "No se puede eliminar el cliente porque tiene pedidos asociados",
        pedidosAsociados,
      });
    }

    const result = await pool.query(
      `
      DELETE FROM clientes
      WHERE id = $1
      RETURNING *
      `,
      [clienteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Cliente no encontrado",
      });
    }

    return res.json({
      ok: true,
      cliente: mapCliente(result.rows[0]),
    });
  } catch (error) {
    console.error(
      "Error al eliminar cliente:",
      error
    );

    return res.status(500).json({
      error: "Error al eliminar cliente",
      detalle:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
}