import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";
import { account } from "../lib/celo";
import { ripioEnabled, ripioSandbox } from "../lib/config";
import { rampUrl } from "../lib/ramp";
import { ensureOnrampSession } from "../lib/ripio";

export default defineTool({
  description:
    "Devuelve cómo cobrarle a un cliente. Con la API de Ripio: el CVU fijo del vendedor, al que el cliente transfiere " +
    "pesos (cada transferencia se convierte sola y llega a la wallet del agente). Sin la API: un link de ramp.ripio.com. " +
    "Usalo cuando el dueño pida cobrar o un alias para un cliente (registrá antes la venta con registrar_venta).",
  inputSchema: z.object({ montoArs: z.number().positive().optional().describe("Monto en pesos a cobrar") }),
  approval: never(),
  async execute({ montoArs }) {
    if (!ripioEnabled()) return { link: rampUrl(montoArs) };

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
        ...(ripioSandbox() ? { aviso: "Es el entorno de prueba (sandbox) de Ripio: el CVU no recibe plata real." } : {}),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        linkAlternativo: rampUrl(montoArs),
      };
    }
  },
});
