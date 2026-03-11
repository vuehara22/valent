const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

app.get("/api/health", (req, res) => {
  return res.json({
    ok: true,
    message: "Backend funcionando",
  });
});

app.post("/api/parse-remito", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "No se recibió ningún archivo en el campo 'file'.",
      });
    }

    const { originalname, mimetype, size } = req.file;

    console.log("Archivo recibido:");
    console.log({
      originalname,
      mimetype,
      size,
    });

    const isPdf = mimetype === "application/pdf";
    const isImage = mimetype.startsWith("image/");

    if (!isPdf && !isImage) {
      return res.status(400).json({
        ok: false,
        error: "Formato no soportado. Subí un PDF o una imagen.",
      });
    }

    return res.json({
      ok: true,
      source: {
        originalname,
        mimetype,
        size,
      },
      parsed: {
        remitoNro: "00004445",
        fecha: "23/12/2025",
        validez: "22/01/2026",
        cuit: "30717642607",
        razonSocial: "CENTRO ÓPTICO ALTA VISIÓN",
        domicilio: "AV. LIBERTADOR 971",
        ubicacion: "SAN VICENTE, MISIONES",
        telefono: "3755-246654",
        condVenta: "Efectivo",
        condIva: "Consumidor final",
        detalle: `Autocompletado desde archivo: ${originalname}`,
        items: [
          {
            cantidad: 1,
            codigo: "KIT 500",
            descripcion:
              "KIT PREMIUM: (100 ESTUCHES BEIGE), LÍQUIDOS 60ML (CELESTE), 100 BOLSAS (BEIGE) + PAÑOS INTERMEDIOS",
            precioUnitario: 225000,
            ivaPct: 0,
            bonifPct: 0,
          },
          {
            cantidad: 200,
            codigo: "105 XL",
            descripcion: "ESTUCHE XL PREMIUM ROSA, VERDE, LILA",
            precioUnitario: 853,
            ivaPct: 0,
            bonifPct: 0,
          },
        ],
      },
    });
  } catch (error) {
    console.error("Error en /api/parse-remito:", error);

    return res.status(500).json({
      ok: false,
      error: "Error interno del servidor al procesar el archivo.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});