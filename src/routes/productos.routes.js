import { Router } from "express";
import {
  getProductos,
  getProductoById,
  crearProducto,
  actualizarProducto,
  patchProducto,
  eliminarProducto,
} from "../controllers/productos.controller.js";

const router = Router();

router.get("/", getProductos);
router.get("/:id", getProductoById);
router.post("/", crearProducto);
router.put("/:id", actualizarProducto);
router.patch("/:id", patchProducto);
router.delete("/:id", eliminarProducto);

export default router;