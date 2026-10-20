import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";
import { account } from "../lib/celo";
import { ripioEnabled, ripioSandbox } from "../lib/config";
import { rampUrl } from "../lib/ramp";
import { ensureOnrampSession } from "../lib/ripio";

export default defineTool({
  description:
    "Devuelve cómo cobrarle a un cliente: un link de pago de Ripio (el cliente paga en pesos y los wARS llegan a la " +
    "wallet del agente en Celo) o, con la API de Ripio en producción, el CVU fijo del vendedor. " +
    "Usalo cuando el dueño pida cobrar o un alias para un cliente (registrá antes la venta con registrar_venta).",
  inputSchema: z.object({ montoArs: z.number().positive().optional().describe("Monto en pesos a cobrar") }),
  approval: never(),
  async execute({ montoArs }) {
    // El CVU de la API solo recibe plata real en producción; en sandbox se cobra con el link real.
    if (!ripioEnabled() || ripioSandbox()) {
      return {
        link: rampUrl(montoArs),
        instrucciones: "Pasale este link al cliente: ahí paga en pesos con Ripio y la plata te llega sola.",
      };
    }

    try {
      const session = await ensureOnrampSession(account().address);
      const { cvu, alias, status } = session.fiatPaymentInstructions ?? {};
      if (!cvu && !alias) return { error: `Ripio todavía está generando el CVU (estado: ${status ?? "desconocido"}). Probá en un minuto.` };
      return {
        cvu,
        alias,
        montoArs,
        instrucciones: montoArs
          ? `El cliente tiene que transferir exactamente $${montoArs} ARS a este CVU.`
          : "El cliente transfiere pesos a este CVU.",
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        linkAlternativo: rampUrl(montoArs),
      };
    }
  },
});
