import { Router } from "express";
import {
  getClientes,
  crearCliente,
  actualizarCliente,
  eliminarCliente,
} from "../controllers/clientes.controller.js";

const router = Router();

router.get("/", getClientes);
router.post("/", crearCliente);
router.put("/:id", actualizarCliente);
router.delete("/:id", eliminarCliente);

export default router;