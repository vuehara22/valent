import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const databaseUrl = String(process.env.DATABASE_URL || "").trim();

if (!databaseUrl) {
  throw new Error(
    "Falta DATABASE_URL. Revisá el archivo .env ubicado en la raíz del backend."
  );
}

const isRenderDatabase =
  databaseUrl.includes("render.com") ||
  databaseUrl.includes("oregon-postgres");

export const pool = new Pool({
  connectionString: databaseUrl,

  ssl: isRenderDatabase
    ? {
        rejectUnauthorized: false,
      }
    : false,

  /*
   * Mantener un pool pequeño es importante para Render.
   * Cinco conexiones son suficientes para esta aplicación
   * y evitan un consumo excesivo de memoria.
   */
  max: 5,
  min: 0,

  /*
   * Tiempo máximo para esperar una conexión libre.
   */
  connectionTimeoutMillis: 10_000,

  /*
   * Las conexiones inactivas se cierran rápidamente.
   */
  idleTimeoutMillis: 10_000,

  /*
   * Mantiene activa la conexión TCP con PostgreSQL.
   */
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,

  /*
   * El proceso continúa activo aunque no haya conexiones.
   */
  allowExitOnIdle: false,

  application_name: "valent-backend",
});

/*
 * No utilizar setInterval en este archivo.
 *
 * El intervalo anterior se ejecutaba cada dos segundos y podía
 * duplicarse durante reinicios o recargas del módulo.
 * El monitoreo de memoria y pool queda centralizado en server.js.
 */

pool.on("connect", () => {
  if (process.env.NODE_ENV !== "production") {
    console.log("🟢 Nueva conexión PostgreSQL creada");
  }
});

pool.on("acquire", () => {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.DEBUG_DB_POOL === "true"
  ) {
    console.log("🔵 Conexión PostgreSQL adquirida");
  }
});

pool.on("remove", () => {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.DEBUG_DB_POOL === "true"
  ) {
    console.log("🟡 Conexión PostgreSQL eliminada del pool");
  }
});

pool.on("error", (error) => {
  console.error("🔴 Error inesperado del pool PostgreSQL:", {
    message: error?.message || "Error desconocido",
    code: error?.code || null,
    detail: error?.detail || null,
  });
});

export async function testDatabaseConnection() {
  try {
    /*
     * pool.query obtiene y libera automáticamente la conexión.
     */
    const result = await pool.query(`
      SELECT
        NOW() AS fecha,
        current_database() AS database_name,
        current_user AS database_user
    `);

    const row = result.rows[0];

    console.log("🟢 PostgreSQL conectado:", row?.fecha);
    console.log("🗄️ Base de datos:", row?.database_name);
    console.log("👤 Usuario PostgreSQL:", row?.database_user);

    return {
      connected: true,
      fecha: row?.fecha ?? null,
      databaseName: row?.database_name ?? null,
      databaseUser: row?.database_user ?? null,
    };
  } catch (error) {
    console.error("🔴 Error conectando a PostgreSQL:", {
      message: error?.message || "Error desconocido",
      code: error?.code || null,
      detail: error?.detail || null,
    });

    throw error;
  }
}

export async function closeDatabasePool() {
  try {
    console.log("🟡 Cerrando pool PostgreSQL...");

    await pool.end();

    console.log("✅ Pool PostgreSQL cerrado correctamente.");
  } catch (error) {
    console.error("🔴 Error cerrando el pool PostgreSQL:", {
      message: error?.message || "Error desconocido",
      code: error?.code || null,
    });
  }
}

export default pool;