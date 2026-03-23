const express = require("express");
const cors = require("cors");
const multer = require("multer");

// IMPORTANTE: cargar worker antes de pdf-parse
require("pdf-parse/worker");
const { PDFParse } = require("pdf-parse");

const app = express();
const PORT = process.env.PORT || 10000;
const PDF_PARSE_TIMEOUT = 10000;

console.log("Iniciando servidor...");

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

function normalizeSpaces(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function parseMoneyAR(value) {
  if (!value) return 0;

  const cleaned = String(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getRequestedMaxItems(req) {
  const candidates = [
    req.body?.maxItems,
    req.body?.max_items,
    req.body?.itemLimit,
    req.body?.limit,
    req.body?.topK,
    req.query?.maxItems,
    req.query?.max_items,
    req.query?.itemLimit,
    req.query?.limit,
    req.query?.topK,
  ];

  for (const candidate of candidates) {
    const parsed = Number.parseInt(String(candidate ?? "").trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return 30;
}

function extractRemitoNumero(text) {
  const m = text.match(/N[º°o]?:\s*([0-9]+)/i);
  return m?.[1]?.trim() || "";
}

function extractFecha(text) {
  const m = text.match(/Fecha:\s*(\d{2}\/\d{2}\/\d{4})/i);
  return m?.[1]?.trim() || "";
}

function extractValidez(text) {
  const m = text.match(/Validez:\s*(\d{2}\/\d{2}\/\d{4})/i);
  return m?.[1]?.trim() || "";
}

function extractCuit(text) {
  const m = text.match(/CUIT:\s*([0-9]{11})/i);
  return m?.[1]?.trim() || "";
}

function extractRazonSocial(text) {
  const m = text.match(/Raz[oó]n social:\s*(.+?)\s*Domicilio:/i);
  return m?.[1]?.trim() || "";
}

function extractDomicilio(text) {
  const m = text.match(/Domicilio:\s*(.+?)\s*Ubicaci[oó]n:/i);
  return m?.[1]?.trim() || "";
}

function extractUbicacion(text) {
  const m = text.match(/Ubicaci[oó]n:\s*(.+?)\s*Condici[oó]n de venta:/i);
  return m?.[1]?.trim() || "";
}

function extractTelefono(text) {
  const m = text.match(/Tel\.\s*:?\s*([0-9()+\-\s]+)/i);
  return m?.[1]?.trim() || "";
}

function extractCondVenta(text) {
  const m = text.match(
    /Condici[oó]n de venta:\s*(.+?)\s*Condici[oó]n de IVA:/i
  );
  return m?.[1]?.trim() || "";
}

function extractCondIva(text) {
  const m = text.match(/Condici[oó]n de IVA:\s*(.+?)(?:Cantidad Código|$)/i);
  return m?.[1]?.trim() || "";
}

function sanitizeItem(item) {
  return {
    cantidad: Math.max(1, parsePositiveInt(item?.cantidad, 1)),
    codigo: normalizeSpaces(item?.codigo),
    descripcion: normalizeSpaces(item?.descripcion),
    precioUnitario: Math.max(0, parseMoneyAR(item?.precioUnitario)),
    ivaPct: Math.max(0, parseMoneyAR(item?.ivaPct)),
    bonifPct: Math.max(0, parseMoneyAR(item?.bonifPct)),
  };
}

function isValidParsedItem(item) {
  if (!item) return false;

  const codigo = normalizeSpaces(item.codigo);
  const descripcion = normalizeSpaces(item.descripcion);
  const cantidad = Number(item.cantidad) || 0;
  const precioUnitario = Number(item.precioUnitario) || 0;

  if (!codigo && !descripcion && cantidad <= 0 && precioUnitario <= 0) {
    return false;
  }

  const lowerDescripcion = descripcion.toLowerCase();
  const lowerCodigo = codigo.toLowerCase();

  if (
    lowerDescripcion.startsWith("autocompletado desde archivo") ||
    lowerDescripcion.endsWith(".pdf") ||
    lowerDescripcion.endsWith(".png") ||
    lowerDescripcion.endsWith(".jpg") ||
    lowerDescripcion.endsWith(".jpeg") ||
    lowerCodigo === "cantidad" ||
    lowerCodigo === "codigo" ||
    lowerDescripcion.includes("razón social") ||
    lowerDescripcion.includes("condición de iva") ||
    lowerDescripcion.includes("condicion de iva")
  ) {
    return false;
  }

  return true;
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const key = [
      Number(item.cantidad) || 0,
      normalizeSpaces(item.codigo).toLowerCase(),
      normalizeSpaces(item.descripcion).toLowerCase(),
      Number(item.precioUnitario) || 0,
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function extractItems(rawText, maxItems = 30) {
  const originalLines = String(rawText || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const mergedLines = [];
  let current = "";

  for (const line of originalLines) {
    const startsLikeItem = /^\d+\s+[A-Z0-9]/i.test(line);

    if (startsLikeItem) {
      if (current) mergedLines.push(current);
      current = line;
    } else if (current) {
      current += " " + line;
    }
  }

  if (current) mergedLines.push(current);

  const items = [];

  for (const line of mergedLines) {
    if (items.length >= maxItems) break;

    const startMatch = line.match(/^(\d+)\s+([A-Z0-9][A-Z0-9\-/.]*)\s+(.+)$/i);
    if (!startMatch) continue;

    const cantidad = parsePositiveInt(startMatch[1], 1);
    const codigo = normalizeSpaces(startMatch[2]);
    const resto = normalizeSpaces(startMatch[3]);

    const moneyMatches = [...resto.matchAll(/\d{1,3}(?:\.\d{3})*,\d{2}/g)].map(
      (m) => m[0]
    );

    if (!moneyMatches.length) continue;

    const precioUnitario = parseMoneyAR(moneyMatches[0]);

    const pctMatches = [...resto.matchAll(/(\d{1,3}(?:,\d{2})?)\s*%/g)].map(
      (m) => m[1]
    );

    const ivaPct = pctMatches[0] ? parseMoneyAR(pctMatches[0]) : 0;
    const bonifPct = pctMatches[1] ? parseMoneyAR(pctMatches[1]) : 0;

    const firstMoneyIndex = resto.search(/\d{1,3}(?:\.\d{3})*,\d{2}/);
    let descripcion =
      firstMoneyIndex > 0 ? resto.slice(0, firstMoneyIndex).trim() : resto;

    descripcion = normalizeSpaces(descripcion);

    const item = sanitizeItem({
      cantidad,
      codigo,
      descripcion,
      precioUnitario,
      ivaPct,
      bonifPct,
    });

    if (isValidParsedItem(item)) {
      items.push(item);
    }
  }

  return dedupeItems(items).filter(isValidParsedItem).slice(0, maxItems);
}

async function parsePdfWithTimeout(buffer, timeout = PDF_PARSE_TIMEOUT) {
  let parser = null;

  try {
    parser = new PDFParse({ data: buffer });

    const result = await Promise.race([
      parser.getText(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("PDF parse timeout")), timeout);
      }),
    ]);

    return result;
  } finally {
    try {
      if (parser && typeof parser.destroy === "function") {
        await parser.destroy();
      }
    } catch (destroyError) {
      console.error("Error destruyendo parser:", destroyError);
    }
  }
}

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.get("/api/health", (req, res) => {
  return res.json({
    ok: true,
    message: "Backend funcionando",
  });
});

app.post("/api/debug-pdf", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        ok: false,
        error: "Sin archivo",
      });
    }

    const parsedPdf = await parsePdfWithTimeout(req.file.buffer);
    const rawText = parsedPdf?.text || "";

    return res.json({
      ok: true,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      textLength: rawText.length,
      preview: rawText.slice(0, 3000),
      detectedItems: extractItems(rawText, 50),
    });
  } catch (error) {
    console.error("Error en /api/debug-pdf:", error);

    return res.status(500).json({
      ok: false,
      error: error?.message || String(error),
      stack: error?.stack || null,
    });
  }
});

app.post("/api/parse-remito", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "No se recibió ningún archivo en el campo 'file'.",
      });
    }

    const { originalname, mimetype, size, buffer } = req.file;
    const requestedMaxItems = getRequestedMaxItems(req);

    console.log("Archivo recibido:", {
      originalname,
      mimetype,
      size,
      requestedMaxItems,
      hasBuffer: !!buffer,
      bufferLength: buffer ? buffer.length : 0,
    });

    const lowerName = String(originalname || "").toLowerCase();
    const isPdf =
      mimetype === "application/pdf" || lowerName.endsWith(".pdf");

    if (!isPdf) {
      return res.status(400).json({
        ok: false,
        error: "Formato no soportado. Subí un PDF.",
      });
    }

    if (!buffer || !buffer.length) {
      return res.status(400).json({
        ok: false,
        error: "El archivo no contiene datos válidos.",
      });
    }

    console.log("Antes de pdf-parse");

    const parsedPdf = await parsePdfWithTimeout(buffer);

    console.log("Después de pdf-parse", {
      textLength: parsedPdf?.text ? parsedPdf.text.length : 0,
    });

    const rawText = parsedPdf?.text || "";
    const text = normalizeSpaces(rawText);

    if (!rawText.trim()) {
      return res.status(422).json({
        ok: false,
        error:
          "El PDF no contiene texto legible para extraer. Puede ser escaneado.",
      });
    }

    const remitoNro = extractRemitoNumero(text);
    const fecha = extractFecha(text);
    const validez = extractValidez(text);
    const cuit = extractCuit(text);
    const razonSocial = extractRazonSocial(text);
    const domicilio = extractDomicilio(text);
    const ubicacion = extractUbicacion(text);
    const telefono = extractTelefono(text);
    const condVenta = extractCondVenta(text);
    const condIva = extractCondIva(text);
    const items = extractItems(rawText, requestedMaxItems);

    const warnings = [];
    if (!remitoNro) warnings.push("No detecté el número.");
    if (!fecha) warnings.push("No detecté la fecha.");
    if (!razonSocial) warnings.push("No detecté la razón social.");
    if (!items.length) warnings.push("No detecté ítems automáticamente.");

    return res.json({
      ok: true,
      source: {
        originalname,
        mimetype,
        size,
      },
      parsed: {
        remitoNro,
        fecha,
        validez,
        cuit,
        razonSocial,
        domicilio,
        ubicacion,
        telefono,
        condVenta,
        condIva,
        detalle: `Autocompletado desde archivo: ${originalname}`,
        items,
      },
      warnings,
      debug: {
        requestedMaxItems,
        detectedItems: items.length,
        textPreview: rawText.slice(0, 3000),
        mergedItemLines: String(rawText || "")
          .split(/\r?\n/)
          .map((l) => l.replace(/\s+/g, " ").trim())
          .filter(Boolean),
      },
    });
  } catch (error) {
    console.error("Error en /api/parse-remito:");
    console.error("message:", error?.message);
    console.error("stack:", error?.stack);
    console.error("full error:", error);

    if (error?.message === "PDF parse timeout") {
      return res.status(408).json({
        ok: false,
        error:
          "El procesamiento del PDF tardó demasiado. Probá con otro archivo o con un PDF más liviano.",
      });
    }

    return res.status(500).json({
      ok: false,
      error: "Error interno del servidor al procesar el archivo.",
      detail: error?.message || String(error),
      stack: error?.stack || null,
    });
  }
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});