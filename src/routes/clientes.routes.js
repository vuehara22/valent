import { Router } from "express";

import {
  getClientes,
  getClientePorId,
  crearCliente,
  actualizarCliente,
  eliminarCliente,
  getClienteArchivos,
  getClienteArchivoContenido,
} from "../controllers/clientes.controller.js";

const router = Router();

router.get("/", getClientes);

// Debe estar antes de /:id
router.get(
  "/:id/archivos/:archivoId/contenido",
  getClienteArchivoContenido
);

router.get("/:id/archivos", getClienteArchivos);
router.get("/:id", getClientePorId);

router.post("/", crearCliente);
router.put("/:id", actualizarCliente);
router.delete("/:id", eliminarCliente);

export default router;
