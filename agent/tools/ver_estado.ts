import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";
import { walletStatus } from "../lib/pipeline";
import { getDestination, recentSettlements } from "../lib/store";

export default defineTool({
  description:
    "Muestra el estado actual: wallet del agente con sus saldos (wARS, USD₮), cómo se paga el gas, la wallet destino " +
    "configurada y las últimas liquidaciones.",
  inputSchema: z.object({}),
  approval: never(),
  async execute() {
    const { celoForGas, ...wallet } = await walletStatus();
    return {
      ...wallet,
      // Con fee abstraction el gas sale del USD₮: mostrar "0 CELO" llevaba al modelo a decir que faltaba gas.
      gas: process.env.FEE_CURRENCY
        ? "Se paga en USD₮ (no hace falta CELO). Conviene tener al menos 0,05 USD₮ en la wallet del agente."
        : `Se paga en CELO. Saldo: ${celoForGas} CELO`,
      destination: (await getDestination()) ?? null,
      ultimasLiquidaciones: await recentSettlements(5),
    };
  },
});
