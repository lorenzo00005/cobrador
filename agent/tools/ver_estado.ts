import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";
import { walletStatus } from "../lib/pipeline";
import { getDestination, recentSettlements } from "../lib/store";

export default defineTool({
  description:
    "Muestra el estado actual: wallet del agente con sus saldos (wARS, USD₮, CELO para gas), la wallet destino " +
    "configurada y las últimas liquidaciones.",
  inputSchema: z.object({}),
  approval: never(),
  async execute() {
    return {
      ...(await walletStatus()),
      destination: (await getDestination()) ?? null,
      ultimasLiquidaciones: await recentSettlements(5),
    };
  },
});
