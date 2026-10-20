import { formatUnits, parseAbiItem } from "viem";
import { account, publicClient } from "./celo";
import { WARS, WARS_DECIMALS } from "./config";
import { runSettlement } from "./pipeline";
import { syncRipioOrders } from "./ripio-orders";
import {
  claimEvent,
  claimSaleByAmount,
  getScanCursor,
  markSaleSettled,
  nextRipioPaidSale,
  setSaleMessageId,
  setScanCursor,
  type Settlement,
} from "./store";
import { sendOwnerMessage } from "./telegram";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const celoscan = (hash?: string) => (hash ? `https://celoscan.io/tx/${hash}` : "");
const pesos = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
const MAX_RANGE = 5000n; // forno limita el rango de getLogs

/**
 * Detecta los wARS que llegan a la wallet del agente (lo que entrega Ripio al terminar el on-ramp),
 * avisa por Telegram, liquida (wARS → USD₮ → wallet destino) y avisa de nuevo respondiendo el primer mensaje.
 * Idempotente por tx hash + logIndex; la primera corrida arranca desde el bloque actual (o DEPOSITS_FROM_BLOCK).
 */
export async function scanDeposits(): Promise<{ scanned: number; deposits: number }> {
  const head = await publicClient.getBlockNumber();
  let cursor = await getScanCursor();
  if (cursor === undefined) {
    const start = process.env.DEPOSITS_FROM_BLOCK ? BigInt(process.env.DEPOSITS_FROM_BLOCK) - 1n : head;
    await setScanCursor(Number(start));
    cursor = Number(start);
  }

  let from = BigInt(cursor) + 1n;
  let deposits = 0;
  while (from <= head) {
    const to = from + MAX_RANGE - 1n < head ? from + MAX_RANGE - 1n : head;
    const logs = await publicClient.getLogs({
      address: WARS,
      event: transferEvent,
      args: { to: account().address },
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      await handleDeposit(`${log.transactionHash}:${log.logIndex}`, Number(formatUnits(log.args.value ?? 0n, WARS_DECIMALS)));
      deposits++;
    }
    await setScanCursor(Number(to));
    from = to + 1n;
  }
  return { scanned: Number(head) - cursor, deposits };
}

async function handleDeposit(key: string, wars: number): Promise<void> {
  if (!(await claimEvent(`notify:${key}`))) return;

  // Con la API de Ripio, el aviso de pago ya salió al recibirse los pesos: estos wARS son de esa venta
  // y se responde a ese mismo mensaje. Antes se sincroniza por si el polling de Ripio todavía no corrió.
  await syncRipioOrders().catch((e) => console.error("[ripio] error:", e));
  const ripioSale = await nextRipioPaidSale();

  // Sin la API: 1 wARS ≈ 1 peso; tolerancia 2% por comisiones del on-ramp.
  const sale = ripioSale ?? (await claimSaleByAmount(wars, 2));
  const messageId = ripioSale
    ? ripioSale.messageId
    : await sendOwnerMessage(
        sale
          ? `✅ Ya recibí la plata de ${sale.producto}: $${pesos(wars)} ARS.\nAhora la convierto a USD₮ y te la mando a tu wallet.`
          : `✅ Ya recibí $${pesos(wars)} ARS, pero no coincide con ninguna venta registrada.\nIgual la convierto a USD₮ y te la mando a tu wallet.`,
      );
  if (sale && !ripioSale && messageId) await setSaleMessageId(sale.id, messageId);

  const result = await runSettlement(`settle:${key}`);
  if (result.status === "skipped") return;
  const s = result as Settlement;
  const que = sale ? ` de ${sale.producto}` : "";
  if (s.status === "ok") {
    if (sale) await markSaleSettled(sale.id);
    await sendOwnerMessage(
      `💸 Ya mandé la plata${que} a tu wallet.\n${s.warsIn} wARS → ${s.usdtOut} USD₮\nWallet: ${s.destination}\n` +
        `Swap: ${celoscan(s.swapTx)}\nEnvío: ${celoscan(s.transferTx)}`,
      messageId,
    );
  } else {
    await sendOwnerMessage(
      `⚠️ Recibí la plata${que} pero todavía no pude mandarla a tu wallet.\n${s.error}\nPedime "reintentar liquidación" y lo vuelvo a intentar.`,
      messageId,
    );
  }
}
