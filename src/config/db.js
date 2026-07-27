import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL en el archivo .env");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false,
  },

  // No abrir demasiadas conexiones contra Render
  max: 3,
  min: 0,

  // Tiempo para conseguir una conexión libre
  connectionTimeoutMillis: 30000,

  // Cerrar conexiones inactivas
  idleTimeoutMillis: 15000,

  // Dar tiempo suficiente para leer el resultado remoto
  query_timeout: 60000,

  // Tiempo máximo de ejecución dentro de PostgreSQL
  statement_timeout: 60000,

  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,

  allowExitOnIdle: false,
});

pool.on("connect", () => {
  console.log("🟢 Nueva conexión agregada al pool PostgreSQL");
});

pool.on("acquire", () => {
  console.log("🔵 Conexión tomada del pool");
});

pool.on("remove", () => {
  console.log("🟠 Conexión removida del pool");
});

pool.on("error", (error) => {
  console.error("🔴 Error inesperado del pool PostgreSQL:", {
    message: error?.message,
    code: error?.code,
  });
});

export async function testDatabaseConnection() {
  let client;

  try {
    client = await pool.connect();

    const result = await client.query(`
      SELECT
        NOW() AS fecha,
        current_database() AS database_name
    `);

    console.log(
      "🟢 PostgreSQL de Render conectado:",
      result.rows[0]?.fecha
    );

    return true;
  } catch (error) {
    console.error("🔴 Error conectando a PostgreSQL:", {
      message: error?.message,
      code: error?.code,
    });

    return false;
  } finally {
    client?.release();
  }
}

export default pool;