import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getAddress, isAddress, type Address } from "viem";

/**
 * Estado persistente del agente: wallet destino, eventos ya procesados e historial.
 *
 * Implementación en archivo JSON, válida para `eve dev` y un host con disco persistente.
 * En Vercel el filesystem es efímero: reemplazá estas funciones por Vercel KV / Upstash / Postgres
 * manteniendo la misma interfaz.
 */
export interface Settlement {
  eventId: string;
  at: string;
  status: "ok" | "failed";
  warsIn?: string;
  usdtOut?: string;
  destination?: Address;
  swapTx?: string;
  transferTx?: string;
  error?: string;
}

/** Una venta registrada por el dueño: producto + monto esperado en pesos. */
export interface Sale {
  id: string;
  producto: string;
  montoArs: number;
  status: "pendiente" | "cobrada" | "liquidada";
  createdAt: string;
  /** message_id del aviso "ya recibí la plata", para responderle con el aviso de envío. */
  messageId?: number;
  /** Orden de on-ramp de Ripio que pagó esta venta (solo con la API de Ramps). */
  orderId?: string;
}

interface State {
  destination?: Address;
  processed: string[];
  history: Settlement[];
  sales?: Sale[];
  /** Último bloque de Celo ya escaneado en busca de depósitos de wARS. */
  scanCursor?: number;
  /** true después de la primera lectura de órdenes de Ripio (las previas no se avisan). */
  ripioSynced?: boolean;
  /** orderId de Ripio → message_id del aviso "ya recibí", para encadenar los avisos siguientes. */
  ripioMessages?: Record<string, number>;
}

const FILE = process.env.STATE_FILE ?? ".data/state.json";

async function load(): Promise<State> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as State;
  } catch {
    return { processed: [], history: [] };
  }
}

async function save(state: State): Promise<void> {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(state, null, 2));
}

export async function getDestination(): Promise<Address | undefined> {
  const state = await load();
  if (state.destination) return state.destination;
  const fromEnv = process.env.DESTINATION_WALLET;
  return fromEnv && isAddress(fromEnv) ? getAddress(fromEnv) : undefined;
}

export async function setDestination(address: string): Promise<Address> {
  if (!isAddress(address)) throw new Error("Dirección inválida");
  const state = await load();
  state.destination = getAddress(address);
  await save(state);
  return state.destination;
}

/** Marca un evento como en proceso. Devuelve false si ya se había procesado (idempotencia). */
export async function claimEvent(eventId: string): Promise<boolean> {
  const state = await load();
  if (state.processed.includes(eventId)) return false;
  state.processed.push(eventId);
  state.processed = state.processed.slice(-500);
  await save(state);
  return true;
}

export async function releaseEvent(eventId: string): Promise<void> {
  const state = await load();
  state.processed = state.processed.filter((id) => id !== eventId);
  await save(state);
}

export async function recordSettlement(settlement: Settlement): Promise<void> {
  const state = await load();
  state.history = [settlement, ...state.history].slice(0, 100);
  await save(state);
}

export async function recentSettlements(limit = 5): Promise<Settlement[]> {
  return (await load()).history.slice(0, limit);
}

// ---------- Ventas (producto ↔ pago) ----------

export async function addSale(producto: string, montoArs: number): Promise<Sale> {
  const state = await load();
  const sale: Sale = {
    id: `v${Date.now().toString(36)}`,
    producto,
    montoArs,
    status: "pendiente",
    createdAt: new Date().toISOString(),
  };
  state.sales = [...(state.sales ?? []), sale].slice(-200);
  await save(state);
  return sale;
}

export async function listSales(limit = 10): Promise<Sale[]> {
  return [...((await load()).sales ?? [])].reverse().slice(0, limit);
}

/** Toma la venta pendiente más vieja cuyo monto coincide con el depósito (tolerancia de $1) y la marca cobrada. */
export async function claimSaleByAmount(montoArs: number, tolerancePct = 0): Promise<Sale | undefined> {
  const state = await load();
  const sale = (state.sales ?? []).find((s) => s.status === "pendiente" && Math.abs(s.montoArs - montoArs) <= Math.max(1, (s.montoArs * tolerancePct) / 100));
  if (!sale) return undefined;
  sale.status = "cobrada";
  await save(state);
  return sale;
}

export async function setSaleMessageId(id: string, messageId: number): Promise<void> {
  const state = await load();
  const sale = (state.sales ?? []).find((s) => s.id === id);
  if (sale) sale.messageId = messageId;
  await save(state);
}

/** La venta cobrada más vieja que todavía no se liquidó (se asocia a la próxima liquidación, en orden). */
export async function nextPaidSale(): Promise<Sale | undefined> {
  return ((await load()).sales ?? []).find((s) => s.status === "cobrada");
}

export async function markSaleSettled(id: string): Promise<void> {
  const state = await load();
  const sale = (state.sales ?? []).find((s) => s.id === id);
  if (sale) sale.status = "liquidada";
  await save(state);
}

export async function setSaleOrder(id: string, orderId: string): Promise<void> {
  const state = await load();
  const sale = (state.sales ?? []).find((s) => s.id === id);
  if (sale) sale.orderId = orderId;
  await save(state);
}

export async function findSaleByOrder(orderId: string): Promise<Sale | undefined> {
  return ((await load()).sales ?? []).find((s) => s.orderId === orderId);
}

/** La venta más vieja que Ripio ya cobró y todavía no se liquidó: los wARS que llegan on-chain son de ella. */
export async function nextRipioPaidSale(): Promise<Sale | undefined> {
  return ((await load()).sales ?? []).find((s) => s.status === "cobrada" && s.orderId);
}

export async function isRipioSynced(): Promise<boolean> {
  return Boolean((await load()).ripioSynced);
}

export async function setRipioSynced(): Promise<void> {
  const state = await load();
  state.ripioSynced = true;
  await save(state);
}

export async function getRipioMessage(orderId: string): Promise<number | undefined> {
  return (await load()).ripioMessages?.[orderId];
}

export async function setRipioMessage(orderId: string, messageId: number): Promise<void> {
  const state = await load();
  state.ripioMessages = { ...(state.ripioMessages ?? {}), [orderId]: messageId };
  await save(state);
}

export async function getScanCursor(): Promise<number | undefined> {
  return (await load()).scanCursor;
}

export async function setScanCursor(block: number): Promise<void> {
  const state = await load();
  state.scanCursor = block;
  await save(state);
}
