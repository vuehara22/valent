import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const isRender = !!process.env.DATABASE_URL;

export const pool = new Pool({
  // 👉 Si está en Render usa DATABASE_URL
  connectionString: isRender ? process.env.DATABASE_URL : undefined,

  // 👉 Si está en local usa tus variables
  host: isRender ? undefined : process.env.DB_HOST || "localhost",
  port: isRender ? undefined : Number(process.env.DB_PORT || 5432),
  database: isRender ? undefined : process.env.DB_NAME || "valent_db",
  user: isRender ? undefined : process.env.DB_USER || "postgres",
  password: isRender ? undefined : process.env.DB_PASSWORD,

  // 👉 IMPORTANTE para Render (SSL)
  ssl: isRender ? { rejectUnauthorized: false } : false,
});

// opcional pero MUY útil para debug
pool.on("connect", () => {
  console.log("🟢 Conectado a PostgreSQL");
});

pool.on("error", (err) => {
  console.error("🔴 Error en PostgreSQL:", err);
});