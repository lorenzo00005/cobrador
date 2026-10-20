import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";
import { account } from "../lib/celo";
import { ripioEnabled, ripioSandbox } from "../lib/config";
import { ensureOnrampSession, simulateDeposit } from "../lib/ripio";
import { syncRipioOrders } from "../lib/ripio-orders";

export default defineTool({
  description:
    "SOLO PRUEBAS (sandbox de Ripio): simula que un cliente transfirió pesos al CVU, para probar los avisos de punta a " +
    "punta. Usalo únicamente si el dueño pide simular o probar un pago. No mueve plata real.",
  inputSchema: z.object({ montoArs: z.number().min(2100).max(500000).describe("Monto en pesos a simular") }),
  approval: never(),
  async execute({ montoArs }) {
    if (!ripioEnabled()) return { error: "La API de Ripio no está configurada." };
    if (!ripioSandbox()) return { error: "Solo se puede simular en el sandbox de Ripio, no en producción." };

    const session = await ensureOnrampSession(account().address);
    const cvu = session.fiatPaymentInstructions?.cvu;
    if (!cvu) return { error: "La sesión de Ripio todavía no tiene CVU." };

    await simulateDeposit(cvu, montoArs);
    await new Promise((r) => setTimeout(r, 3000)); // Ripio crea la orden en segundos
    await syncRipioOrders();
    return { ok: true, montoArs, cvu, nota: "El aviso de pago llega solo por Telegram." };
  },
});
