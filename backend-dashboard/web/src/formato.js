export const hora = (fecha) => new Date(fecha).toLocaleTimeString("es-AR", { hour12: false });

export const fechaHora = (fecha) =>
  new Date(fecha).toLocaleString("es-AR", { hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
