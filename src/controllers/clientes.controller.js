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
        expreso
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
          updated_at = NOW()
      WHERE id = $13
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