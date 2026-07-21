import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || "postgres",
      password: String(process.env.DB_PASSWORD || ""),
      database: process.env.DB_NAME || "valent",
      ssl: false,
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
  console.error("🔴 Error inesperado en PostgreSQL:", error);
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
    console.error(
      "🔴 Error al conectar con la base de datos:",
      error.message
    );

    return false;
  }
}

export default pool;