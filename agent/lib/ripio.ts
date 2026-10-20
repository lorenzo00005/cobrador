import { createHmac, timingSafeEqual } from "node:crypto";
import { env, ripioBase, ripioChain, ripioCurrency } from "./config";

/**
 * Cliente de la API de Ramps de Ripio (docs.ripio.com/ramps-api).
 * El vendedor es un "customer" de Ripio (RIPIO_CUSTOMER_ID, con KYC aprobado y T&C aceptados);
 * su sesión de on-ramp le da un CVU fijo: cada transferencia en pesos crea una orden sola y
 * Ripio entrega el cripto en la wallet del agente.
 */

let cachedToken: { value: string; expiresAt: number } | undefined;

/** OAuth2 client-credentials. El token dura horas: se cachea y se renueva un minuto antes de vencer. */
async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const basic = Buffer.from(`${env("RIPIO_CLIENT_ID")}:${env("RIPIO_CLIENT_SECRET")}`).toString("base64");
  const response = await fetch(`${ripioBase()}/oauth2/token/`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`Ripio auth ${response.status}`);
  const json = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

/** Llamada autenticada. Devuelve el status y el JSON (o null si no hay body). */
async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${ripioBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const fail = (what: string, r: { status: number; json: any }) =>
  new Error(`Ripio ${what} ${r.status}: ${r.json?.detail?.message ?? JSON.stringify(r.json)}`);

export interface OnrampSession {
  sessionId: string;
  chain: string;
  currency: string;
  depositAddress: string;
  fiatPaymentInstructions?: { cvu?: string; alias?: string; status?: string };
}

/**
 * Devuelve la sesión de on-ramp del vendedor (el CVU al que le transfieren los clientes).
 * Si no existe, o apunta a otra wallet/red, la crea o actualiza: Ripio reutiliza el mismo CVU.
 */
export async function ensureOnrampSession(depositAddress: string): Promise<OnrampSession> {
  const customerId = env("RIPIO_CUSTOMER_ID");
  const current = await call("GET", `/api/v1/customers/${customerId}/onrampSession/`);
  if (current.status === 200) {
    const s = current.json as OnrampSession;
    const same =
      s.depositAddress?.toLowerCase() === depositAddress.toLowerCase() &&
      s.chain === ripioChain() &&
      s.currency === ripioCurrency();
    if (same) return s;
  } else if (current.status !== 404) {
    throw fail("sesión", current);
  }

  const created = await call("POST", "/api/v1/onrampSession/", {
    customerId,
    paymentMethodType: "bank_transfer",
    chain: ripioChain(),
    currency: ripioCurrency(),
    depositAddress,
  });
  if (created.status !== 200 && created.status !== 201) throw fail("crear sesión", created);
  return created.json as OnrampSession;
}

/** Orden de on-ramp tal como la devuelve el listado del customer. */
export interface OnrampOrder {
  transactionId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "CANCELLED" | "REFUNDED" | string;
  createdAt: string;
  fromAmount: string;
  toAmount: string;
  fromCurrency: string;
  toCurrency: string;
  chain: string;
  txnHash: string | null;
  failureReason: string | null;
  failureDetail: string | null;
  timeline?: { paymentReceived?: { status: string } };
}

/** Últimas órdenes de on-ramp del vendedor (la primera página alcanza para el polling de cada minuto). */
export async function listOnrampOrders(): Promise<OnrampOrder[]> {
  const r = await call("GET", `/api/v1/customers/${env("RIPIO_CUSTOMER_ID")}/transactions/onramp/`);
  if (r.status !== 200) throw fail("órdenes", r);
  return (r.json?.results ?? []) as OnrampOrder[];
}

/** Solo sandbox: simula que alguien transfirió `amount` pesos al CVU. */
export async function simulateDeposit(cvu: string, amount: number): Promise<void> {
  const r = await call("POST", "/api/v1/simulateDeposit/", {
    paymentMethodType: "bank_transfer",
    amount,
    alias_or_cvu: cvu,
  });
  if (r.status !== 200 && r.status !== 201) throw fail("simular depósito", r);
}

/** Verifica `Http-X-Wh-Signature-256: sha256=<hex>` (HMAC-SHA256 sobre el body crudo). */
export function verifySignature(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected = "sha256=" + createHmac("sha256", env("RIPIO_WEBHOOK_SECRET")).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
