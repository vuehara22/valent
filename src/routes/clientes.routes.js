import { Router } from "express";

import {
  getClientes,
  getClientePorId,
  crearCliente,
  actualizarCliente,
  eliminarCliente,
} from "../controllers/clientes.controller.js";

const router = Router();

/**
 * GET /api/clientes
 * Devuelve todos los clientes.
 */
router.get("/", getClientes);

/**
 * GET /api/clientes/:id
 * Devuelve un cliente específico con todos sus logos y DXF.
 */
router.get("/:id", getClientePorId);

/**
 * POST /api/clientes
 * Crea un cliente con uno o varios logos/DXF.
 */
router.post("/", crearCliente);

/**
 * PUT /api/clientes/:id
 * Actualiza los datos y archivos de un cliente.
 */
router.put("/:id", actualizarCliente);

/**
 * DELETE /api/clientes/:id
 * Elimina un cliente si no tiene pedidos asociados.
 */
router.delete("/:id", eliminarCliente);

export default router;