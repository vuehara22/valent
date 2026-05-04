import express from "express";

import {
  getMovimientosCuentaCorriente,
  createMovimientoCuentaCorriente,
  deleteMovimientoCuentaCorriente,
} from "../controllers/cuentaCorriente.controller.js";

const router = express.Router();

router.get("/", getMovimientosCuentaCorriente);
router.post("/", createMovimientoCuentaCorriente);
router.delete("/:id", deleteMovimientoCuentaCorriente);

export default router;