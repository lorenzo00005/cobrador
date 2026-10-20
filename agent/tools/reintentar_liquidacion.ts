import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { forwardUsdt, runSettlement, type SettlementResult } from "../lib/pipeline";
import { sendOwnerMessage } from "../lib/telegram";

const celoscan = (hash?: string) => (hash ? `https://celoscan.io/tx/${hash}` : "");

/** Texto fijo con el resultado real: el modelo no lo redacta, así no inventa causas ni montos. */
function resultText(r: SettlementResult): string {
  if (r.status === "skipped") return `ℹ️ No hice nada: ${r.reason}`;
  if (r.status === "failed") return `⚠️ No pude completar la liquidación.\nMotivo: ${r.error}`;
  return (
    `💸 Listo, mandé la plata a tu wallet.\n` +
    (r.warsIn ? `${r.warsIn} wARS → ` : "") +
    `${r.usdtOut} USD₮\nWallet: ${r.destination}\n` +
    (r.swapTx ? `Swap: ${celoscan(r.swapTx)}\n` : "") +
    `Envío: ${celoscan(r.transferTx)}`
  );
}

export default defineTool({
  description:
    "Reintenta una liquidación que falló. 'completa' vuelve a correr wARS → USD₮ → destino con los wARS que haya en la " +
    "wallet del agente. 'solo_envio' reenvía a la wallet destino el USD₮ que ya quedó en la wallet del agente " +
    "(cuando el swap salió bien pero falló el envío). Requiere confirmación del dueño. El resultado se le avisa " +
    "solo al dueño por Telegram.",
  inputSchema: z.object({ modo: z.enum(["completa", "solo_envio"]) }),
  approval: always(),
  async execute({ modo }) {
    const result = modo === "completa" ? await runSettlement(`manual-${Date.now()}`) : await forwardUsdt();
    await sendOwnerMessage(resultText(result));
    return {
      yaAvisado: true,
      estado: result.status,
      nota: "El resultado exacto ya se le mandó al dueño en un mensaje aparte. No lo repitas ni agregues causas.",
    };
  },
});
