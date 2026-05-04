import express from "express";
import cors from "cors";
import multer from "multer";
import * as pdfParseModule from "pdf-parse";
import productosRoutes from "./routes/productos.routes.js";
import clientesRoutes from "./routes/clientes.routes.js";
import presupuestosRoutes from "./routes/presupuestos.routes.js";
import pedidosRoutes from "./routes/pedidos.routes.js";

const pdfParse = pdfParseModule.default ?? pdfParseModule;

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

function normalizeSpaces(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function extractRemitoNumero(text) {
  const m = text.match(/N[°º]?:\s*([0-9]+)/i);
  return m?.[1]?.trim() || "";
}

function extractFecha(text) {
  const m = text.match(/Fecha:\s*(\d{2}\/\d{2}\/\d{4})/i);
  return m?.[1]?.trim() || "";
}

function extractCliente(text) {
  const m = text.match(/Raz[oó]n social:\s*(.+?)\s*Domicilio:/i);
  return m?.[1]?.trim() || "";
}

function extractCondicionVenta(text) {
  const m = text.match(/Condici[oó]n de venta:\s*(.+?)\s*(Condici[oó]n de IVA|$)/i);
  return m?.[1]?.trim() || "";
}

function mapEstadoPago(condVenta) {
  const v = (condVenta || "").toLowerCase();
  if (v.includes("efectivo")) return "COBRADO";
  if (v.includes("transfer")) return "COBRADO";
  if (v.includes("mercado")) return "COBRADO";
  if (v.includes("cuenta")) return "SALDO";
  if (v.includes("adelanto") || v.includes("anticipo")) return "ADELANTO";
  return "PENDIENTE";
}

function parseMoneyAR(s) {
  const cleaned = String(s)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function extractItems(text) {
  const items = [];
  const lines = (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const m = line.match(
      /^(\d+)\s+([A-Z0-9]+(?:\s+[A-Z0-9]+)?)\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+.*\s+(\d{1,3}(?:\.\d{3})*,\d{2})$/i
    );

    if (m) {
      const cantidad = Number(m[1]);
      const codigo = m[2].trim();
      const descripcion = m[3].trim();
      const unitario = parseMoneyAR(m[4]);
      const total = parseMoneyAR(m[5]);

      items.push({ cantidad, codigo, descripcion, unitario, total });
    }
  }

  return items;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, message: "Servidor funcionando" });
});

app.use("/api/productos", productosRoutes);
app.use("/api/clientes", clientesRoutes);
app.use("/api/presupuestos", presupuestosRoutes);
app.use("/api/pedidos", pedidosRoutes);

app.post("/api/parse-remito", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file" });
    }

    const pdf = await pdfParse(req.file.buffer);
    const rawText = pdf.text || "";
    const text = normalizeSpaces(rawText);

    const remitoNumero = extractRemitoNumero(text);
    const fecha = extractFecha(text);
    const cliente = extractCliente(text);
    const condicionVenta = extractCondicionVenta(text);
    const estadoPago = mapEstadoPago(condicionVenta);
    const items = extractItems(rawText);

    const warnings = [];
    if (!cliente) warnings.push("No detecté Cliente automáticamente.");
    if (!fecha) warnings.push("No detecté Fecha automáticamente.");
    if (!remitoNumero) warnings.push("No detecté Nº automáticamente.");

    return res.json({
      cliente,
      fecha,
      remitoNumero,
      sector: "VENTAS",
      detalle: "",
      estadoPago,
      condicionVenta,
      items,
      warnings,
    });
  } catch (error) {
    console.error("Error parseando PDF:", error);
    return res.status(500).json({ error: "Error parseando PDF" });
  }
});

const PORT = 4000;

app.listen(PORT, () => {
  console.log(`✅ API escuchando en http://localhost:${PORT}`);
});