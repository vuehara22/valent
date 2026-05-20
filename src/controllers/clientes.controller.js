import { pool } from "../config/db.js";

function mapCliente(row) {
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
  };
}

function clean(v) {
  return String(v ?? "").trim();
}

export async function getClientes(_req, res) {
  try {
    const result = await pool.query(`
      SELECT *
      FROM clientes
      ORDER BY nombre ASC
    `);

    res.json(result.rows.map(mapCliente));
  } catch (error) {
    console.error("Error al obtener clientes:", error);
    res.status(500).json({ error: "Error al obtener clientes" });
  }
}

export async function crearCliente(req, res) {
  try {
    const c = req.body;

    if (!clean(c.nombre)) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
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
        nota_envio_horario
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *
      `,
      [
        clean(c.nombre),
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
        clean(c.notaEnvioOptica || c.nombre),
        clean(c.notaEnvioRecibe || c.nombreApellido),
        clean(c.notaEnvioDomicilio || c.direccionEnvio || c.direccion),
        clean(c.notaEnvioLocalidad || c.localidad),
        clean(c.notaEnvioTelefono || c.telefono),
        clean(c.notaEnvioCuitDni || c.cuit || c.dni),
        clean(c.notaEnvioHorario),
      ]
    );

    res.status(201).json(mapCliente(result.rows[0]));
  } catch (error) {
    console.error("Error al crear cliente:", error);
    res.status(500).json({ error: "Error al crear cliente" });
  }
}

export async function actualizarCliente(req, res) {
  try {
    const { id } = req.params;
    const c = req.body;

    if (!clean(c.nombre)) {
      return res.status(400).json({ error: "El nombre es obligatorio" });
    }

    const result = await pool.query(
      `
      UPDATE clientes
      SET nombre = $1,
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
          updated_at = NOW()
      WHERE id = $20
      RETURNING *
      `,
      [
        clean(c.nombre),
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
        clean(c.notaEnvioOptica || c.nombre),
        clean(c.notaEnvioRecibe || c.nombreApellido),
        clean(c.notaEnvioDomicilio || c.direccionEnvio || c.direccion),
        clean(c.notaEnvioLocalidad || c.localidad),
        clean(c.notaEnvioTelefono || c.telefono),
        clean(c.notaEnvioCuitDni || c.cuit || c.dni),
        clean(c.notaEnvioHorario),
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    res.json(mapCliente(result.rows[0]));
  } catch (error) {
    console.error("Error al actualizar cliente:", error);
    res.status(500).json({ error: "Error al actualizar cliente" });
  }
}

export async function eliminarCliente(req, res) {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM clientes
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    res.json({ ok: true, cliente: mapCliente(result.rows[0]) });
  } catch (error) {
    console.error("Error al eliminar cliente:", error);
    res.status(500).json({ error: "Error al eliminar cliente" });
  }
}