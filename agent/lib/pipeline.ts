import { formatUnits, type Address } from "viem";
import { allowanceOf, account, balanceOf, publicClient, sendTagged, transferData } from "./celo";
import { USDT, USDT_DECIMALS, WARS, WARS_DECIMALS, maxSwapWars } from "./config";
import { claimEvent, getDestination, recordSettlement, releaseEvent, type Settlement } from "./store";
import { reportSubmit, requestQuote } from "./textile";
import { parseUnits } from "viem";

export type SettlementResult = Settlement | { status: "skipped"; reason: string };

/**
 * Margen de USD₮ a dejar para pagar el gas cuando la fee-currency es el MISMO token que enviamos.
 * En Celo, transferir el 100% del saldo mientras se paga gas en ese token hace revertir la tx
 * (el débito de la comisión se queda sin fondos). Configurable con USDT_GAS_BUFFER.
 */
const gasBufferUsdt = () => parseUnits(process.env.USDT_GAS_BUFFER ?? "0.02", USDT_DECIMALS);

/** Monto de USD₮ realmente enviable: si pagamos gas en USD₮, reservamos el margen; si no, va todo. */
function sendableUsdt(balance: bigint): bigint {
  if (!process.env.FEE_CURRENCY) return balance; // gas en CELO nativo → se puede mandar todo
  const buffer = gasBufferUsdt();
  return balance > buffer ? balance - buffer : 0n;
}

/**
 * Liquidación determinística: wARS recibidos → swap a USD₮ en Textile FX (Celo) → envío a la wallet destino.
 * Se ejecuta en código (no por decisión del LLM) para que mover plata nunca dependa de lo que diga un chat.
 *
 * Idempotente por `eventId`: un webhook duplicado no genera un segundo swap.
 */
export async function runSettlement(eventId: string): Promise<SettlementResult> {
  if (!(await claimEvent(eventId))) return { status: "skipped", reason: "evento ya procesado" };

  const base = { eventId, at: new Date().toISOString() } as const;
  const destination = await getDestination();
  if (!destination) {
    await releaseEvent(eventId);
    return fail(base, "No hay wallet destino configurada.");
  }

  let swapped = false;
  try {
    const me = account().address;
    const balance = await balanceOf(WARS, me);
    if (balance === 0n) {
      await releaseEvent(eventId);
      return fail(base, "La wallet del agente no tiene wARS para liquidar (todavía no llegaron).", destination);
    }

    const cap = parseUnits(String(maxSwapWars()), WARS_DECIMALS);
    const sellAmount = balance > cap ? cap : balance;

    const q = await requestQuote(WARS, USDT, sellAmount);
    if (!q) {
      await releaseEvent(eventId);
      return fail(base, "Textile FX no tiene liquidez para cotizar ahora. Se puede reintentar.", destination);
    }

    // 1) approve al reactor si el allowance no alcanza (también va con tag de atribución)
    if ((await allowanceOf(WARS, me, q.quote.reactor)) < BigInt(q.quote.takerPays)) {
      await sendTagged(q.transactions.approval);
    }

    // 2) la cotización vence: si se pasó el plazo, pedimos otra en el próximo intento
    if (Date.now() >= Date.parse(q.quote.expiresAt)) {
      await releaseEvent(eventId);
      return fail(base, "La cotización venció antes de ejecutar. Se puede reintentar.", destination);
    }

    // 3) swap
    const usdtBefore = await balanceOf(USDT, me);
    const swapTx = await sendTagged(q.transactions.swap);
    swapped = true;
    await reportSubmit(q, swapTx);
    // El market maker de Textile liquida el USD₮ de forma asíncrona: a veces entra varios
    // segundos DESPUÉS de que confirma la tx del taker. Esperamos a que aparezca antes de rendirnos.
    let received = 0n;
    for (let i = 0; i < 20; i++) {
      received = (await balanceOf(USDT, me)) - usdtBefore;
      if (received > 0n) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (received <= 0n)
      throw new Error(`El swap ${swapTx} confirmó pero no entró USD₮ a la wallet (timeout esperando al market maker).`);

    // 4) envío al destino final (dejando margen de gas si se paga en USD₮)
    const toSend = sendableUsdt(received);
    if (toSend === 0n) throw new Error("USD₮ recibido insuficiente para enviar dejando margen de gas.");
    const transferTx = await sendTagged({ to: USDT, data: transferData(destination, toSend) });

    const result: Settlement = {
      ...base,
      status: "ok",
      warsIn: formatUnits(sellAmount, WARS_DECIMALS),
      usdtOut: formatUnits(toSend, USDT_DECIMALS),
      destination,
      swapTx,
      transferTx,
    };
    await recordSettlement(result);
    return result;
  } catch (error) {
    // Si el swap ya ocurrió, NO liberamos el evento: la plata quedó en USD₮ y se reenvía con `reenviarUsdt`.
    if (!swapped) await releaseEvent(eventId);
    return fail(base, error instanceof Error ? error.message : String(error), destination);
  }
}

/** Reenvía a la wallet destino todo el USD₮ que haya quedado en la wallet del agente. */
export async function forwardUsdt(): Promise<SettlementResult> {
  const base = { eventId: `forward-${Date.now()}`, at: new Date().toISOString() } as const;
  const destination = await getDestination();
  if (!destination) return fail(base, "No hay wallet destino configurada.");
  try {
    const balance = await balanceOf(USDT, account().address);
    const amount = sendableUsdt(balance);
    if (amount === 0n)
      return {
        status: "skipped",
        reason: "No hay USD₮ suficiente para enviar dejando margen de gas en la wallet del agente.",
      };
    const transferTx = await sendTagged({ to: USDT, data: transferData(destination, amount) });
    const result: Settlement = {
      ...base,
      status: "ok",
      usdtOut: formatUnits(amount, USDT_DECIMALS),
      destination,
      transferTx,
    };
    await recordSettlement(result);
    return result;
  } catch (error) {
    return fail(base, error instanceof Error ? error.message : String(error), destination);
  }
}

async function fail(
  base: { eventId: string; at: string },
  error: string,
  destination?: Address,
): Promise<Settlement> {
  const result: Settlement = { ...base, status: "failed", error, destination };
  await recordSettlement(result);
  return result;
}

export async function walletStatus() {
  const me = account().address;
  const [wars, usdt, celo] = await Promise.all([
    balanceOf(WARS, me),
    balanceOf(USDT, me),
    publicClient.getBalance({ address: me }),
  ]);
  return {
    agentWallet: me,
    wars: formatUnits(wars, WARS_DECIMALS),
    usdt: formatUnits(usdt, USDT_DECIMALS),
    celoForGas: formatUnits(celo, 18),
  };
}
