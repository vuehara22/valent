import "dotenv/config";

import http from "http";

import cors from "cors";
import express from "express";
import multer from "multer";
import { Server } from "socket.io";

import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

import {
  pool,
  testDatabaseConnection,
  closeDatabasePool,
} from "./src/config/db.js";

import {
  initializeProductosSchema,
} from "./src/controllers/productos.controller.js";

import { initRealtime } from "./src/realtime.js";

import clientesRoutes from "./src/routes/clientes.routes.js";
import cuentaCorrienteRoutes from "./src/routes/cuentaCorriente.routes.js";
import pedidosRoutes from "./src/routes/pedidos.routes.js";
import preferencesRoutes from "./src/routes/preferences.routes.js";
import presupuestosRoutes from "./src/routes/presupuestos.routes.js";
import productosRoutes from "./src/routes/productos.routes.js";
import usuariosRoutes from "./src/routes/usuarios.routes.js";

const app = express();

const PORT = Number(process.env.PORT) || 4000;

const server = http.createServer(app);

let shuttingDown = false;

/* =========================================================
   CORS
========================================================= */

const allowedOrigins = String(
  process.env.CORS_ORIGINS ||
    "https://valent.cuyenslama.com,http://localhost:5173,http://localhost:3000"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function corsOrigin(origin, callback) {
  /*
   * Permite herramientas sin origin, como Postman, Render
   * health checks y algunas peticiones internas.
   */
  if (!origin) {
    return callback(null, true);
  }

  if (
    allowedOrigins.includes("*") ||
    allowedOrigins.includes(origin)
  ) {
    return callback(null, true);
  }

  console.warn("⚠️ Origen bloqueado por CORS:", origin);

  return callback(
    new Error(`Origen no permitido por CORS: ${origin}`)
  );
}

const corsOptions = {
  origin: corsOrigin,

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
  ],

  credentials: true,

  optionsSuccessStatus: 204,
};

/* =========================================================
   SOCKET.IO
========================================================= */

const io = new Server(server, {
  cors: corsOptions,

  /*
   * Evita mensajes gigantes enviados accidentalmente
   * mediante Socket.IO.
   */
  maxHttpBufferSize: 1 * 1024 * 1024,

  /*
   * Configuración estable para conexiones remotas.
   */
  pingInterval: 25_000,
  pingTimeout: 20_000,

  transports: [
    "websocket",
    "polling",
  ],
});

initRealtime(io);

io.on("connection", (socket) => {
  console.log(
    `🔌 Socket conectado: ${socket.id}. Total: ${io.engine.clientsCount}`
  );

  socket.on("disconnect", (reason) => {
    console.log(
      `🔌 Socket desconectado: ${socket.id}. Motivo: ${reason}. Total: ${io.engine.clientsCount}`
    );
  });

  socket.on("error", (error) => {
    console.error("Error de Socket.IO:", {
      socketId: socket.id,
      message: error?.message || "Error desconocido",
    });
  });
});

/* =========================================================
   MIDDLEWARES GENERALES
========================================================= */

app.disable("x-powered-by");

app.use(cors(corsOptions));

app.use(
  express.json({
    limit: "20mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "20mb",
    parameterLimit: 5_000,
  })
);

/* =========================================================
   LOG DE PETICIONES LENTAS
========================================================= */

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startedAt;

    if (duration >= 5_000) {
      console.warn("🐌 Petición lenta:", {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: duration,
      });
    }
  });

  next();
});

/* =========================================================
   CONFIGURACIÓN DE MULTER PARA PDF
========================================================= */

const upload = multer({
  /*
   * memoryStorage conserva todo el PDF en memoria.
   * Por eso limitamos el archivo a 12 MB.
   */
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 12 * 1024 * 1024,
    files: 1,
    fields: 20,
  },

  fileFilter: (_req, file, callback) => {
    const nombre = String(
      file.originalname || ""
    ).toLowerCase();

    const esPdf =
      file.mimetype === "application/pdf" ||
      nombre.endsWith(".pdf");

    if (!esPdf) {
      return callback(
        new Error(
          "El archivo debe estar en formato PDF"
        )
      );
    }

    return callback(null, true);
  },
});

/* =========================================================
   MONITOREO DE MEMORIA
========================================================= */

/*
 * Un único intervalo global.
 *
 * No colocar este bloque dentro de:
 * - io.on("connection")
 * - un controlador
 * - una ruta
 * - una función que se ejecute más de una vez
 */
const memoryMonitor = setInterval(() => {
  const memory = process.memoryUsage();

  const stats = {
    rssMB: Math.round(
      memory.rss / 1024 / 1024
    ),

    heapUsedMB: Math.round(
      memory.heapUsed / 1024 / 1024
    ),

    heapTotalMB: Math.round(
      memory.heapTotal / 1024 / 1024
    ),

    externalMB: Math.round(
      memory.external / 1024 / 1024
    ),

    arrayBuffersMB: Math.round(
      memory.arrayBuffers / 1024 / 1024
    ),

    sockets: io.engine.clientsCount,

    pool: {
      total: pool.totalCount,
      libres: pool.idleCount,
      esperando: pool.waitingCount,
    },
  };

  console.log("🧠 ESTADO DEL SERVIDOR:", stats);

  /*
   * Aviso anticipado. No reinicia el servidor, pero deja
   * registrado cuándo empieza a crecer demasiado.
   */
  if (stats.rssMB >= 350) {
    console.warn(
      "⚠️ Uso de memoria elevado:",
      stats
    );
  }
}, 60_000);

/*
 * El intervalo no mantiene el proceso abierto por sí solo.
 */
memoryMonitor.unref();

/* =========================================================
   RUTAS GENERALES
========================================================= */

app.get("/", (_req, res) => {
  return res.json({
    ok: true,
    message:
      "VALENT backend funcionando con PostgreSQL",
  });
});

app.get("/api/health", async (_req, res) => {
  try {
    const database =
      await testDatabaseConnection();

    const memory =
      process.memoryUsage();

    return res.json({
      ok: true,

      message:
        "API y PostgreSQL funcionando",

      database,

      memory: {
        rssMB: Math.round(
          memory.rss / 1024 / 1024
        ),

        heapUsedMB: Math.round(
          memory.heapUsed / 1024 / 1024
        ),
      },

      sockets:
        io.engine.clientsCount,

      pool: {
        total: pool.totalCount,
        libres: pool.idleCount,
        esperando: pool.waitingCount,
      },
    });
  } catch (error) {
    console.error(
      "Error en health check:",
      error
    );

    return res.status(503).json({
      ok: false,

      message:
        "La API funciona, pero PostgreSQL no está conectado",

      error:
        error instanceof Error
          ? error.message
          : "Error desconocido",
    });
  }
});

/* =========================================================
   RUTAS DE LA API
========================================================= */

app.use(
  "/api/productos",
  productosRoutes
);

app.use(
  "/api/clientes",
  clientesRoutes
);

app.use(
  "/api/presupuestos",
  presupuestosRoutes
);

app.use(
  "/api/pedidos",
  pedidosRoutes
);

app.use(
  "/api/preferences",
  preferencesRoutes
);

app.use(
  "/api/usuarios",
  usuariosRoutes
);

app.use(
  "/api/cuenta-corriente",
  cuentaCorrienteRoutes
);

/* =========================================================
   FUNCIONES PARA LEER REMITOS Y PRESUPUESTOS
========================================================= */

function normalizeSpaces(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoneyAR(value) {
  const cleaned = String(value ?? "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const number = Number(cleaned);

  return Number.isFinite(number)
    ? number
    : 0;
}

function extractNumero(text) {
  const patterns = [
    /N[°º]?:\s*([0-9]+)/i,
    /Presupuesto\s*N[°º]?:?\s*([0-9]+)/i,
    /Nro\.?\s*Presupuesto\s*:?\s*([0-9]+)/i,
    /Remito\s*N[°º]?:?\s*([0-9]+)/i,
    /Nro\.?\s*Remito\s*:?\s*([0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return "";
}

function extractFecha(text) {
  const patterns = [
    /Fecha:\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Fecha\s+(\d{2}\/\d{2}\/\d{4})/i,
    /(\d{2}\/\d{2}\/\d{4})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return "";
}

function extractCliente(text) {
  const patterns = [
    /Raz[oó]n social:\s*(.+?)\s*Domicilio:/i,

    /Cliente:\s*(.+?)\s*(Domicilio|CUIT|Condici[oó]n|Tel[eé]fono|$)/i,

    /Señor(?:es)?:\s*(.+?)\s*(Domicilio|CUIT|Condici[oó]n|Tel[eé]fono|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return normalizeSpaces(
        match[1]
      );
    }
  }

  return "";
}

function extractDomicilio(text) {
  const match = text.match(
    /Domicilio:\s*(.+?)\s*(Localidad|Ubicaci[oó]n|CUIT|Tel[eé]fono|Condici[oó]n|$)/i
  );

  return match?.[1]
    ? normalizeSpaces(match[1])
    : "";
}

function extractCuit(text) {
  const match = text.match(
    /CUIT:?\s*([0-9\-]+)/i
  );

  return match?.[1]?.trim() || "";
}

function extractTelefono(text) {
  const match = text.match(
    /Tel[eé]fono:?\s*([0-9\s\-()+]+)/i
  );

  return match?.[1]
    ? normalizeSpaces(match[1])
    : "";
}

function extractCondicionVenta(text) {
  const match = text.match(
    /Condici[oó]n de venta:\s*(.+?)\s*(Condici[oó]n de IVA|IVA|CUIT|$)/i
  );

  return match?.[1]
    ? normalizeSpaces(match[1])
    : "";
}

function extractCondicionIva(text) {
  const match = text.match(
    /Condici[oó]n de IVA:\s*(.+?)\s*(Condici[oó]n de venta|CUIT|Detalle|$)/i
  );

  return match?.[1]
    ? normalizeSpaces(match[1])
    : "";
}

function mapEstadoPago(condicionVenta) {
  const value = String(
    condicionVenta || ""
  ).toLowerCase();

  if (value.includes("efectivo")) {
    return "COBRADO";
  }

  if (value.includes("transfer")) {
    return "COBRADO";
  }

  if (value.includes("mercado")) {
    return "COBRADO";
  }

  if (value.includes("cuenta")) {
    return "SALDO";
  }

  if (
    value.includes("adelanto") ||
    value.includes("anticipo")
  ) {
    return "ADELANTO";
  }

  return "PENDIENTE";
}

function isBadItemLine(line) {
  const normalized = normalizeSpaces(
    line
  ).toLowerCase();

  if (!normalized) {
    return true;
  }

  const invalidStarts = [
    "subtotal",
    "total",
    "iva",
    "bonificacion",
    "bonificación",
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

  return invalidStarts.some(
    (value) =>
      normalized.startsWith(value)
  );
}

function normalizeParsedItem(item) {
  return {
    cantidad: Math.max(
      1,
      Number(item.cantidad) || 1
    ),

    codigo: String(
      item.codigo || ""
    ).trim(),

    descripcion: normalizeSpaces(
      item.descripcion || ""
    ),

    precioUnitario: Math.max(
      0,
      Number(item.precioUnitario) || 0
    ),

    ivaPct: Math.max(
      0,
      Number(item.ivaPct) || 0
    ),

    bonifPct: Math.max(
      0,
      Number(item.bonifPct) || 0
    ),
  };
}

function extractItemsFromLines(rawText) {
  const items = [];

  const lines = String(
    rawText || ""
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (isBadItemLine(line)) {
      continue;
    }

    let match = line.match(
      /^(\d+(?:[.,]\d+)?)\s+([A-Z0-9][A-Z0-9\-/.]*)\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+.*)?$/i
    );

    if (match) {
      items.push(
        normalizeParsedItem({
          cantidad:
            parseMoneyAR(match[1]),

          codigo:
            match[2],

          descripcion:
            match[3],

          precioUnitario:
            parseMoneyAR(match[4]),
        })
      );

      continue;
    }

    match = line.match(
      /^([A-Z0-9][A-Z0-9\-/.]*)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+.*)?$/i
    );

    if (match) {
      items.push(
        normalizeParsedItem({
          cantidad:
            parseMoneyAR(match[3]),

          codigo:
            match[1],

          descripcion:
            match[2],

          precioUnitario:
            parseMoneyAR(match[4]),
        })
      );
    }
  }

  return items;
}

function extractItemsFallback(rawText) {
  const lines = String(
    rawText || ""
  )
    .split("\n")
    .map((line) =>
      normalizeSpaces(line)
    )
    .filter(Boolean)
    .filter(
      (line) =>
        !isBadItemLine(line)
    );

  return lines
    .slice(0, 30)
    .map((line) => {
      const codeMatch = line.match(
        /\b([A-Z]{1,5}[-/]?[0-9]{1,8}|[0-9]{3,})\b/i
      );

      const priceMatch = line.match(
        /(\d{1,3}(?:\.\d{3})*,\d{2})/
      );

      return normalizeParsedItem({
        cantidad: 1,

        codigo:
          codeMatch?.[1] || "",

        descripcion:
          line,

        precioUnitario:
          priceMatch
            ? parseMoneyAR(
                priceMatch[1]
              )
            : 0,
      });
    })
    .filter(
      (item) =>
        item.codigo ||
        item.descripcion
    );
}

function extractItems(text) {
  const parsedItems =
    extractItemsFromLines(text);

  if (parsedItems.length > 0) {
    return parsedItems;
  }

  return extractItemsFallback(
    text
  );
}

/* =========================================================
   FUNCIÓN PARA EXTRAER TEXTO DE UN PDF
========================================================= */

async function obtenerTextoPdf(buffer) {
  const pdf = new PDFParse({
    data: buffer,
  });

  try {
    const result =
      await pdf.getText();

    return {
      rawText:
        result?.text || "",

      text: normalizeSpaces(
        result?.text || ""
      ),
    };
  } finally {
    if (
      typeof pdf.destroy ===
      "function"
    ) {
      await pdf
        .destroy()
        .catch(() => {});
    }
  }
}

/* =========================================================
   PARSEAR REMITO
========================================================= */

app.post(
  "/api/parse-remito",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error:
            "No se recibió archivo",
        });
      }

      const {
        rawText,
        text,
      } = await obtenerTextoPdf(
        req.file.buffer
      );

      /*
       * Liberamos la referencia al Buffer apenas termina
       * la lectura del PDF.
       */
      req.file.buffer =
        Buffer.alloc(0);

      const remitoNumero =
        extractNumero(text);

      const fecha =
        extractFecha(text);

      const cliente =
        extractCliente(text);

      const condicionVenta =
        extractCondicionVenta(text);

      const estadoPago =
        mapEstadoPago(
          condicionVenta
        );

      const items =
        extractItems(rawText);

      const warnings = [];

      if (!cliente) {
        warnings.push(
          "No detecté Cliente automáticamente."
        );
      }

      if (!fecha) {
        warnings.push(
          "No detecté Fecha automáticamente."
        );
      }

      if (!remitoNumero) {
        warnings.push(
          "No detecté Nº automáticamente."
        );
      }

      if (!items.length) {
        warnings.push(
          "No detecté productos automáticamente."
        );
      }

      return res.json({
        ok: true,

        parsed: {
          numero:
            remitoNumero,

          remitoNro:
            remitoNumero,

          fecha,

          cliente,

          razonSocial:
            cliente,

          domicilio:
            extractDomicilio(text),

          cuit:
            extractCuit(text),

          telefono:
            extractTelefono(text),

          condVenta:
            condicionVenta,

          condicionVenta,

          condIva:
            extractCondicionIva(
              text
            ),

          sector: "VENTAS",

          detalle: "",

          estadoPago,

          items,

          warnings,
        },
      });
    } catch (error) {
      if (req.file?.buffer) {
        req.file.buffer =
          Buffer.alloc(0);
      }

      console.error(
        "Error parseando remito:",
        error
      );

      return res.status(500).json({
        error:
          "Error parseando remito",

        detail:
          error instanceof Error
            ? error.message
            : "Error desconocido",
      });
    }
  }
);

/* =========================================================
   PARSEAR PRESUPUESTO
========================================================= */

app.post(
  "/api/parse-presupuesto",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error:
            "No se recibió archivo",
        });
      }

      const {
        rawText,
        text,
      } = await obtenerTextoPdf(
        req.file.buffer
      );

      req.file.buffer =
        Buffer.alloc(0);

      const numero =
        extractNumero(text);

      const fecha =
        extractFecha(text);

      const cliente =
        extractCliente(text);

      const domicilio =
        extractDomicilio(text);

      const cuit =
        extractCuit(text);

      const telefono =
        extractTelefono(text);

      const condVenta =
        extractCondicionVenta(text);

      const condIva =
        extractCondicionIva(text);

      const items =
        extractItems(rawText);

      const warnings = [];

      if (!cliente) {
        warnings.push(
          "No detecté Cliente automáticamente."
        );
      }

      if (!fecha) {
        warnings.push(
          "No detecté Fecha automáticamente."
        );
      }

      if (!numero) {
        warnings.push(
          "No detecté Nº de presupuesto automáticamente."
        );
      }

      if (!items.length) {
        warnings.push(
          "No detecté productos automáticamente."
        );
      }

      return res.json({
        ok: true,

        parsed: {
          numero,

          remitoNro:
            numero,

          fecha,

          validez: "",

          cuit,

          razonSocial:
            cliente,

          cliente,

          domicilio,

          ubicacion: "",

          telefono,

          condVenta,

          condicionVenta:
            condVenta,

          condIva,

          detalle: "",

          items,

          warnings,
        },
      });
    } catch (error) {
      if (req.file?.buffer) {
        req.file.buffer =
          Buffer.alloc(0);
      }

      console.error(
        "Error parseando presupuesto:",
        error
      );

      return res.status(500).json({
        error:
          "Error parseando presupuesto",

        detail:
          error instanceof Error
            ? error.message
            : "Error desconocido",
      });
    }
  }
);

/* =========================================================
   RUTA NO ENCONTRADA
========================================================= */

app.use((req, res) => {
  return res.status(404).json({
    ok: false,
    error: "Ruta no encontrada",
    method: req.method,
    path: req.originalUrl,
  });
});

/* =========================================================
   MANEJO GENERAL DE ERRORES
========================================================= */

app.use(
  (
    error,
    _req,
    res,
    _next
  ) => {
    console.error(
      "Error general del servidor:",
      {
        message:
          error?.message ||
          "Error desconocido",

        code:
          error?.code ||
          null,

        type:
          error?.type ||
          null,
      }
    );

    if (
      error instanceof
      multer.MulterError
    ) {
      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res.status(413).json({
          ok: false,

          error:
            "El PDF supera el límite permitido de 12 MB",
        });
      }

      return res.status(400).json({
        ok: false,

        error:
          "Error al cargar el archivo",

        detail:
          error.message,
      });
    }

    if (
      error?.type ===
      "entity.too.large"
    ) {
      return res.status(413).json({
        ok: false,

        error:
          "La petición supera el límite permitido de 20 MB",
      });
    }

    if (
      String(error?.message || "").startsWith(
        "Origen no permitido por CORS"
      )
    ) {
      return res.status(403).json({
        ok: false,
        error: error.message,
      });
    }

    if (
      error?.message ===
      "El archivo debe estar en formato PDF"
    ) {
      return res.status(400).json({
        ok: false,
        error: error.message,
      });
    }

    return res.status(
      error?.status || 500
    ).json({
      ok: false,

      error:
        error?.message ||
        "Error interno del servidor",
    });
  }
);

/* =========================================================
   CIERRE ORDENADO
========================================================= */

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    `\n🟡 ${signal}: cerrando servidor...`
  );

  clearInterval(memoryMonitor);

  /*
   * Deja de aceptar conexiones nuevas y espera que las
   * peticiones actuales terminen.
   */
  server.close(async (serverError) => {
    if (serverError) {
      console.error(
        "Error cerrando el servidor HTTP:",
        serverError
      );
    }

    try {
      io.close();
    } catch (error) {
      console.error(
        "Error cerrando Socket.IO:",
        error
      );
    }

    await closeDatabasePool();

    console.log(
      "✅ Servidor cerrado correctamente."
    );

    process.exit(
      serverError ? 1 : 0
    );
  });

  /*
   * Evita que el proceso quede bloqueado indefinidamente.
   */
  const forceShutdown =
    setTimeout(async () => {
      console.error(
        "🔴 Cierre forzado después de 10 segundos."
      );

      try {
        io.close();
      } catch {
        // Ignorado durante cierre forzado.
      }

      await closeDatabasePool();

      process.exit(1);
    }, 10_000);

  forceShutdown.unref();
}

process.once(
  "SIGINT",
  () => {
    void shutdown("SIGINT");
  }
);

process.once(
  "SIGTERM",
  () => {
    void shutdown("SIGTERM");
  }
);

process.on(
  "unhandledRejection",
  (reason) => {
    console.error(
      "🔴 Promesa rechazada sin manejar:",
      reason
    );
  }
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "🔴 Excepción no controlada:",
      error
    );

    void shutdown(
      "uncaughtException"
    );
  }
);

/* =========================================================
   INICIAR SERVIDOR
========================================================= */

async function startServer() {
  try {
    const database =
      await testDatabaseConnection();

    console.log(
      "✅ PostgreSQL conectado:",
      database
    );

    /*
     * Se ejecuta una sola vez al iniciar.
     * No debe ejecutarse en cada GET /api/productos.
     */
    await initializeProductosSchema();

    console.log(
      "✅ Esquema de productos verificado"
    );

    server.listen(PORT, "0.0.0.0", () => {
      console.log(
        `🚀 SERVER OK en puerto ${PORT}`
      );

      console.log(
        "🌐 Entorno:",
        process.env.NODE_ENV ||
          "development"
      );
    });
  } catch (error) {
    console.error(
      "❌ No se pudo iniciar el servidor:",
      error instanceof Error
        ? error.message
        : error
    );

    await closeDatabasePool();

    process.exit(1);
  }
}

void startServer();