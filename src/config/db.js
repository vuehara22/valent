import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 5,
      min: 0,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      query_timeout: 30000,
      statement_timeout: 30000,
      allowExitOnIdle: false,
    }
  : {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || "postgres",
      password: String(process.env.DB_PASSWORD || ""),
      database: process.env.DB_NAME || "valent",
      ssl: false,
      max: 5,
      min: 0,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      query_timeout: 30000,
      statement_timeout: 30000,
      allowExitOnIdle: false,
    };

export const pool = new Pool(poolConfig);

pool.on("connect", () => {
  console.log(
    process.env.DATABASE_URL
      ? "🟢 Conectado a PostgreSQL de Render"
      : "🟢 Conectado a PostgreSQL local"
  );
});

pool.on("error", (error) => {
  console.error("🔴 Error inesperado en PostgreSQL:", {
    message: error?.message,
    code: error?.code,
  });
});

export async function testDatabaseConnection() {
  try {
    const result = await pool.query("SELECT NOW() AS fecha_actual");

    console.log(
      "🟢 Base de datos conectada correctamente:",
      result.rows[0].fecha_actual
    );

    return true;
  } catch (error) {
    console.error("🔴 Error al conectar con la base de datos:", {
      message: error?.message,
      code: error?.code,
    });

    return false;
  }
}

export default pool;