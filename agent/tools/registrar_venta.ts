import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";
import { addSale, listSales } from "../lib/store";

export default defineTool({
  description:
    "Registra una venta: el producto y el monto en pesos que va a pagar el cliente. Cuando entre una transferencia por " +
    "ese monto, el agente avisa 'Ya recibí la plata de <producto>' y después 'Ya mandé la plata a tu wallet'. " +
    "Usalo cuando el dueño diga que va a cobrar un producto o le pase un alias a un cliente. Si no pasa el monto, preguntalo.",
  inputSchema: z.object({
    producto: z.string().min(1).describe("Nombre del producto vendido"),
    montoArs: z.number().positive().describe("Monto en pesos argentinos que debe transferir el cliente"),
  }),
  approval: never(),
  async execute({ producto, montoArs }) {
    const venta = await addSale(producto, montoArs);
    const pendientes = (await listSales(20)).filter((v) => v.status === "pendiente");
    const mismoMonto = pendientes.filter((v) => v.montoArs === montoArs).length;
    return {
      venta,
      aviso:
        mismoMonto > 1
          ? "Hay más de una venta pendiente con el mismo monto: el pago se asocia a la más vieja. " +
            "Conviene diferenciar los montos (por ejemplo sumando unos centavos)."
          : undefined,
    };
  },
});
