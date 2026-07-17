let ioInstance = null;

export function initRealtime(io) {
  ioInstance = io;
}

export function emitPedidoActualizado(payload = {}) {
  if (!ioInstance) return;

  ioInstance.emit("pedido_actualizado", {
    tipo: payload.tipo || "ACTUALIZADO",
    pedidoId: payload.pedidoId || null,
    sector: payload.sector || null,
    at: new Date().toISOString(),
  });
}