import { Router } from "express";
import {
  getPresupuestos,
  getPresupuestoById,
  crearPresupuesto,
  actualizarPresupuesto,
  aprobarPresupuesto,
  eliminarPresupuesto,
} from "../controllers/presupuestos.controller.js";

const router = Router();

router.get("/", getPresupuestos);
router.get("/:id", getPresupuestoById);
router.post("/", crearPresupuesto);
router.put("/:id", actualizarPresupuesto);
router.patch("/:id/aprobar", aprobarPresupuesto);
router.delete("/:id", eliminarPresupuesto);

export default router;