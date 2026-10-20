import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { forwardUsdt, runSettlement } from "../lib/pipeline";

export default defineTool({
  description:
    "Reintenta una liquidación que falló. 'completa' vuelve a correr wARS → USD₮ → destino con los wARS que haya en la " +
    "wallet del agente. 'solo_envio' reenvía a la wallet destino el USD₮ que ya quedó en la wallet del agente " +
    "(cuando el swap salió bien pero falló el envío). Requiere confirmación del dueño.",
  inputSchema: z.object({ modo: z.enum(["completa", "solo_envio"]) }),
  approval: always(),
  async execute({ modo }) {
    return modo === "completa" ? runSettlement(`manual-${Date.now()}`) : forwardUsdt();
  },
});
