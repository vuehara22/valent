import multer from "multer";

const storage = multer.memoryStorage();

function fileFilter(_req, file, callback) {
  const nombre = String(file.originalname || "").toLowerCase();
  const mimeType = String(file.mimetype || "").toLowerCase();

  const esImagen =
    mimeType.startsWith("image/") ||
    /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(nombre);

  const esDxf =
    nombre.endsWith(".dxf") ||
    mimeType === "application/dxf" ||
    mimeType === "application/x-dxf" ||
    mimeType === "image/vnd.dxf" ||
    mimeType === "application/octet-stream";

  if (!esImagen && !esDxf) {
    return callback(
      new Error(
        "Solo se permiten imágenes o archivos DXF"
      )
    );
  }

  callback(null, true);
}

export const uploadClienteArchivo = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter,
});