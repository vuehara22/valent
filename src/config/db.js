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
   * Cinco conexiones permiten que clientes, pedidos,
   * presupuestos, productos y usuarios consulten sin
   * bloquear inmediatamente el pool.
   */
  max: 5,
  min: 0,

  /*
   * Tiempo máximo para conseguir una conexión libre.
   * No es el tiempo máximo de ejecución de una consulta.
   */
  connectionTimeoutMillis: 15000,

  /*
   * Las conexiones sin actividad se pueden cerrar
   * después de treinta segundos.
   */
  idleTimeoutMillis: 30000,

  /*
   * Mantiene viva la conexión TCP contra la base remota.
   */
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,

  /*
   * El backend continúa activo aunque momentáneamente
   * no haya conexiones utilizadas.
   */
  allowExitOnIdle: false,

  application_name: "valent-backend",
});

/*
 * No agregamos query_timeout.
 * Era el responsable de los errores "Query read timeout"
 * y de que las conexiones fueran descartadas constantemente.
 *
 * Tampoco aplicamos statement_timeout globalmente porque
 * algunos controllers ejecutan migraciones o verificaciones
 * de esquema que pueden demorar más.
 */
setInterval(() => {
  console.log("📊 ESTADO DEL POOL:", {
    total: pool.totalCount,
    libres: pool.idleCount,
    esperando: pool.waitingCount,
  });
}, 2000);
pool.on("error", (error) => {
  
  console.error("🔴 Error inesperado del pool PostgreSQL:", {
    message: error?.message || "Error desconocido",
    code: error?.code || null,
  });
});

export async function testDatabaseConnection() {
  try {
    /*
     * Usamos pool.query directamente.
     * Así la conexión se libera automáticamente sin depender
     * de un client.release() manual.
     */
    const result = await pool.query(`
      SELECT
        NOW() AS fecha,
        current_database() AS database_name,
        current_user AS database_user
    `);

    const row = result.rows[0];

    console.log("🟢 PostgreSQL de Render conectado:", row?.fecha);
    console.log("🗄️ Base de datos:", row?.database_name);

    return true;
  } catch (error) {
    console.error("🔴 Error conectando a PostgreSQL:", {
      message: error?.message || "Error desconocido",
      code: error?.code || null,
    });

    return false;
  }
}

/*
 * Permite cerrar correctamente el pool cuando el proceso
 * se detiene manualmente.
 */
async function closePool(signal) {
  try {
    console.log(`\n🟡 ${signal}: cerrando pool PostgreSQL...`);
    await pool.end();
    console.log("✅ Pool PostgreSQL cerrado correctamente.");
  } catch (error) {
    console.error("🔴 Error cerrando el pool PostgreSQL:", {
      message: error?.message || "Error desconocido",
    });
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", () => {
  void closePool("SIGINT");
});

process.once("SIGTERM", () => {
  void closePool("SIGTERM");
});

export default pool;