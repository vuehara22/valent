import "dotenv/config";

import express from "express";
import cors from "cors";
import multer from "multer";

import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

import productosRoutes from "./src/routes/productos.routes.js";
import clientesRoutes from "./src/routes/clientes.routes.js";
import presupuestosRoutes from "./src/routes/presupuestos.routes.js";
import pedidosRoutes from "./src/routes/pedidos.routes.js";
import preferencesRoutes from "./src/routes/preferences.routes.js";
import usuariosRoutes from "./src/routes/usuarios.routes.js";
import cuentaCorrienteRoutes from "./src/routes/cuentaCorriente.routes.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "VALENT backend funcionando con PostgreSQL",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    message: "API funcionando",
    db: "postgresql",
  });
});

app.use("/api/productos", productosRoutes);
app.use("/api/clientes", clientesRoutes);
app.use("/api/presupuestos", presupuestosRoutes);
app.use("/api/pedidos", pedidosRoutes);
app.use("/api/preferences", preferencesRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/cuenta-corriente", cuentaCorrienteRoutes);

function normalizeSpaces(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function parseMoneyAR(s) {
  const cleaned = String(s ?? "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function extractNumero(text) {
  const patterns = [
    /N[°º]?:\s*([0-9]+)/i,
    /Presupuesto\s*N[°º]?:?\s*([0-9]+)/i,
    /Nro\.?\s*Presupuesto\s*:?\s*([0-9]+)/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }

  return "";
}

function extractFecha(text) {
  const patterns = [
    /Fecha:\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Fecha\s+(\d{2}\/\d{2}\/\d{4})/i,
    /(\d{2}\/\d{2}\/\d{4})/,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }

  return "";
}

function extractCliente(text) {
  const patterns = [
    /Raz[oó]n social:\s*(.+?)\s*Domicilio:/i,
    /Cliente:\s*(.+?)\s*(Domicilio|CUIT|Condici[oó]n|Tel[eé]fono|$)/i,
    /Señor(?:es)?:\s*(.+?)\s*(Domicilio|CUIT|Condici[oó]n|Tel[eé]fono|$)/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return normalizeSpaces(m[1]);
  }

  return "";
}

function extractDomicilio(text) {
  const m = text.match(/Domicilio:\s*(.+?)\s*(Localidad|Ubicaci[oó]n|CUIT|Tel[eé]fono|Condici[oó]n|$)/i);
  return m?.[1] ? normalizeSpaces(m[1]) : "";
}

function extractCuit(text) {
  const m = text.match(/CUIT:?\s*([0-9\-]+)/i);
  return m?.[1]?.trim() || "";
}

function extractTelefono(text) {
  const m = text.match(/Tel[eé]fono:?\s*([0-9\s\-()+]+)/i);
  return m?.[1] ? normalizeSpaces(m[1]) : "";
}

function extractCondicionVenta(text) {
  const m = text.match(
    /Condici[oó]n de venta:\s*(.+?)\s*(Condici[oó]n de IVA|IVA|CUIT|$)/i
  );
  return m?.[1] ? normalizeSpaces(m[1]) : "";
}

function extractCondicionIva(text) {
  const m = text.match(/Condici[oó]n de IVA:\s*(.+?)\s*(Condici[oó]n de venta|CUIT|Detalle|$)/i);
  return m?.[1] ? normalizeSpaces(m[1]) : "";
}

function mapEstadoPago(condVenta) {
  const v = String(condVenta || "").toLowerCase();

  if (v.includes("efectivo")) return "COBRADO";
  if (v.includes("transfer")) return "COBRADO";
  if (v.includes("mercado")) return "COBRADO";
  if (v.includes("cuenta")) return "SALDO";
  if (v.includes("adelanto") || v.includes("anticipo")) return "ADELANTO";

  return "PENDIENTE";
}

function isBadItemLine(line) {
  const l = normalizeSpaces(line).toLowerCase();

  if (!l) return true;

  const badStarts = [
    "subtotal",
    "total",
    "iva",
    "bonificacion",
    "descuento",
    "condicion",
    "condición",
    "fecha",
    "domicilio",
    "razon social",
    "razón social",
    "cliente",
    "cuit",
    "telefono",
    "teléfono",
    "presupuesto",
    "remito",
  ];

  return badStarts.some((x) => l.startsWith(x));
}

function normalizeParsedItem(item) {
  return {
    cantidad: Math.max(1, Number(item.cantidad) || 1),
    codigo: String(item.codigo || "").trim(),
    descripcion: normalizeSpaces(item.descripcion || ""),
    precioUnitario: Math.max(0, Number(item.precioUnitario) || 0),
    ivaPct: Math.max(0, Number(item.ivaPct) || 0),
    bonifPct: Math.max(0, Number(item.bonifPct) || 0),
  };
}

function extractItemsFromLines(rawText) {
  const items = [];

  const lines = String(rawText || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (isBadItemLine(line)) continue;

    let m = line.match(
      /^(\d+(?:[.,]\d+)?)\s+([A-Z0-9][A-Z0-9\-\/.]*)\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+.*)?$/i
    );

    if (m) {
      items.push(
        normalizeParsedItem({
          cantidad: parseMoneyAR(m[1]),
          codigo: m[2],
          descripcion: m[3],
          precioUnitario: parseMoneyAR(m[4]),
        })
      );
      continue;
    }

    m = line.match(
      /^([A-Z0-9][A-Z0-9\-\/.]*)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+.*)?$/i
    );

    if (m) {
      items.push(
        normalizeParsedItem({
          cantidad: parseMoneyAR(m[3]),
          codigo: m[1],
          descripcion: m[2],
          precioUnitario: parseMoneyAR(m[4]),
        })
      );
      continue;
    }
  }

  return items;
}

function extractItemsFallback(rawText) {
  const lines = String(rawText || "")
    .split("\n")
    .map((l) => normalizeSpaces(l))
    .filter(Boolean)
    .filter((l) => !isBadItemLine(l));

  return lines
    .slice(0, 30)
    .map((line) => {
      const codeMatch = line.match(/\b([A-Z]{1,5}[-/]?[0-9]{1,8}|[0-9]{3,})\b/i);
      const priceMatch = line.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/);

      return normalizeParsedItem({
        cantidad: 1,
        codigo: codeMatch?.[1] || "",
        descripcion: line,
        precioUnitario: priceMatch ? parseMoneyAR(priceMatch[1]) : 0,
      });
    })
    .filter((x) => x.codigo || x.descripcion);
}

function extractItems(text) {
  const items = extractItemsFromLines(text);

  if (items.length) return items;

  return extractItemsFallback(text);
}

app.post("/api/parse-remito", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió archivo" });
    }

    const pdf = new PDFParse({ data: req.file.buffer });
    const result = await pdf.getText();

    const rawText = result.text || "";
    const text = normalizeSpaces(rawText);

    const remitoNumero = extractNumero(text);
    const fecha = extractFecha(text);
    const cliente = extractCliente(text);
    const condicionVenta = extractCondicionVenta(text);
    const estadoPago = mapEstadoPago(condicionVenta);
    const items = extractItems(rawText);

    const warnings = [];

    if (!cliente) warnings.push("No detecté Cliente automáticamente.");
    if (!fecha) warnings.push("No detecté Fecha automáticamente.");
    if (!remitoNumero) warnings.push("No detecté Nº automáticamente.");
    if (!items.length) warnings.push("No detecté productos automáticamente.");

    res.json({
      ok: true,
      parsed: {
        numero: remitoNumero,
        remitoNro: remitoNumero,
        fecha,
        cliente,
        razonSocial: cliente,
        domicilio: extractDomicilio(text),
        cuit: extractCuit(text),
        telefono: extractTelefono(text),
        condVenta: condicionVenta,
        condicionVenta,
        condIva: extractCondicionIva(text),
        sector: "VENTAS",
        detalle: "",
        estadoPago,
        items,
        warnings,
      },
    });
  } catch (error) {
    console.error("Error parseando remito:", error);

    res.status(500).json({
      error: "Error parseando remito",
      detail: error.message,
    });
  }
});

app.post("/api/parse-presupuesto", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió archivo" });
    }

    const pdf = new PDFParse({ data: req.file.buffer });
    const result = await pdf.getText();

    const rawText = result.text || "";
    const text = normalizeSpaces(rawText);

    const numero = extractNumero(text);
    const fecha = extractFecha(text);
    const cliente = extractCliente(text);
    const domicilio = extractDomicilio(text);
    const cuit = extractCuit(text);
    const telefono = extractTelefono(text);
    const condVenta = extractCondicionVenta(text);
    const condIva = extractCondicionIva(text);
    const items = extractItems(rawText);

    const warnings = [];

    if (!cliente) warnings.push("No detecté Cliente automáticamente.");
    if (!fecha) warnings.push("No detecté Fecha automáticamente.");
    if (!numero) warnings.push("No detecté Nº de presupuesto automáticamente.");
    if (!items.length) warnings.push("No detecté productos automáticamente.");

    res.json({
      ok: true,
      parsed: {
        numero,
        remitoNro: numero,
        fecha,
        validez: "",
        cuit,
        razonSocial: cliente,
        cliente,
        domicilio,
        ubicacion: "",
        telefono,
        condVenta,
        condicionVenta: condVenta,
        condIva,
        detalle: "",
        items,
        warnings,
      },
    });
  } catch (error) {
    console.error("Error parseando presupuesto:", error);

    res.status(500).json({
      error: "Error parseando presupuesto",
      detail: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`SERVER OK ${PORT}`);
});