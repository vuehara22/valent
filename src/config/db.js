import pkg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carga explícita del .env de /server ANTES de crear el Pool
dotenv.config({
  path: path.join(__dirname, "..", ".env"),
  override: true,
});

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD ?? ""),
});

pool.on("connect", () => {
  console.log("✅ PostgreSQL conectado");
});

pool.on("error", (err) => {
  console.error("❌ Error de PostgreSQL:", err);
});

export default pool;