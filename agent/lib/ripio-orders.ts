import { ripioDeliversOnCelo, ripioEnabled, ripioSandbox } from "./config";
import { listOnrampOrders, type OnrampOrder } from "./ripio";
import {
  claimEvent,
  claimSaleByAmount,
  findSaleByOrder,
  getRipioMessage,
  isRipioSynced,
  markSaleSettled,
  setRipioMessage,
  setRipioSynced,
  setSaleMessageId,
  setSaleOrder,
} from "./store";
import { sendOwnerMessage } from "./telegram";

const pesos = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

let running: Promise<void> | undefined;

/**
 * Lee las órdenes de on-ramp del vendedor en Ripio y avisa por Telegram lo nuevo:
 *  - pago recibido   → "Ya recibí la plata de <producto>" (empareja la venta por el monto exacto en pesos)
 *  - cripto entregado → en Celo no se avisa acá: el escaneo on-chain liquida los wARS y responde al mismo mensaje.
 *                       En sandbox (Sepolia/RTEST) no hay nada que liquidar y se avisa la entrega.
 *  - cancelada / reembolsada → aviso con el motivo.
 * Corre cada minuto (schedule) y cuando llega un webhook de Ripio. Idempotente por orden y etapa;
 * en la primera corrida solo toma nota de las órdenes existentes, sin avisar.
 */
export function syncRipioOrders(): Promise<void> {
  if (!ripioEnabled()) return Promise.resolve();
  running ??= sync().finally(() => (running = undefined));
  return running;
}

async function sync(): Promise<void> {
  const orders = (await listOnrampOrders()).reverse(); // de la más vieja a la más nueva

  if (!(await isRipioSynced())) {
    for (const o of orders) for (const stage of ["recv", "done", "fail"]) await claimEvent(`ripio:${stage}:${o.transactionId}`);
    await setRipioSynced();
    return;
  }

  for (const o of orders) {
    const paid = o.timeline?.paymentReceived?.status === "completed" || o.status === "PROCESSING" || o.status === "COMPLETED";
    if (paid && (await claimEvent(`ripio:recv:${o.transactionId}`))) await onPaymentReceived(o);
    if (o.status === "COMPLETED" && (await claimEvent(`ripio:done:${o.transactionId}`))) await onDelivered(o);
    if ((o.status === "CANCELLED" || o.status === "REFUNDED") && (await claimEvent(`ripio:fail:${o.transactionId}`)))
      await onFailed(o);
  }
}

async function onPaymentReceived(o: OnrampOrder): Promise<void> {
  const monto = Number(o.fromAmount);
  const sale = await claimSaleByAmount(monto);
  const messageId = await sendOwnerMessage(
    sale
      ? `✅ Ya recibí la plata de ${sale.producto}: $${pesos(monto)} ${o.fromCurrency}.\nRipio la está convirtiendo; después te la mando a tu wallet.`
      : `✅ Ya recibí una transferencia de $${pesos(monto)} ${o.fromCurrency}, pero no coincide con ninguna venta registrada.\nIgual Ripio la convierte y te la mando a tu wallet.`,
  );
  if (sale) {
    await setSaleOrder(sale.id, o.transactionId);
    if (messageId) await setSaleMessageId(sale.id, messageId);
  }
  if (messageId) await setRipioMessage(o.transactionId, messageId);
}

async function onDelivered(o: OnrampOrder): Promise<void> {
  if (ripioDeliversOnCelo(o.chain)) return; // los wARS los detecta y liquida el escaneo on-chain

  const sale = await findSaleByOrder(o.transactionId);
  if (sale) await markSaleSettled(sale.id);
  const que = sale ? ` de ${sale.producto}` : "";
  await sendOwnerMessage(
    `${ripioSandbox() ? "🧪 Sandbox: " : ""}Ripio entregó ${o.toAmount} ${o.toCurrency}${que} en ${o.chain}.\n` +
      (o.txnHash ? `Tx: ${o.txnHash}\n` : "") +
      "Esa red no es Celo, así que no hay liquidación a USD₮.",
    await getRipioMessage(o.transactionId),
  );
}

async function onFailed(o: OnrampOrder): Promise<void> {
  const sale = await findSaleByOrder(o.transactionId);
  const que = sale ? ` de ${sale.producto}` : "";
  await sendOwnerMessage(
    o.status === "REFUNDED"
      ? `↩️ Ripio le devolvió la plata${que} al cliente ($${pesos(Number(o.fromAmount))} ${o.fromCurrency}).`
      : `⚠️ Ripio canceló la orden${que}: ${o.failureDetail ?? o.failureReason ?? "sin detalle"}. Va a devolver los pesos.`,
    await getRipioMessage(o.transactionId),
  );
}
