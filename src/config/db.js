import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

const isRender = Boolean(process.env.DATABASE_URL);

const commonConfig = {
  max: Number(process.env.DB_POOL_MAX || 8),
  min: 0,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  query_timeout: 30000,
  statement_timeout: 30000,
  keepAlive: true,
  allowExitOnIdle: false,
};

const poolConfig = isRender
  ? {
      ...commonConfig,
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : {
      ...commonConfig,
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || "postgres",
      password: String(process.env.DB_PASSWORD || ""),
      database: process.env.DB_NAME || "valent",
      ssl: false,
    };

export const pool = new Pool(poolConfig);

pool.on("error", (error) => {
  console.error("🔴 Error inesperado en PostgreSQL:", {
    message: error?.message,
    code: error?.code,
  });
});

export async function testDatabaseConnection() {
  try {
    const result = await pool.query(
      "SELECT NOW() AS fecha_actual"
    );

    console.log(
      isRender
        ? "🟢 PostgreSQL de Render conectado:"
        : "🟢 PostgreSQL local conectado:",
      result.rows[0].fecha_actual
    );

    return true;
  } catch (error) {
    console.error(
      "🔴 Error al conectar con PostgreSQL:",
      {
        message: error?.message,
        code: error?.code,
      }
    );

    return false;
  }
}

export function getPoolStatus() {
  return {
    total: pool.totalCount,
    libres: pool.idleCount,
    esperando: pool.waitingCount,
  };
}

export default pool;
