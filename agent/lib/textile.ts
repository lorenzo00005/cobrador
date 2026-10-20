import { randomBytes } from "node:crypto";
import { bytesToHex, type Address, type Hex } from "viem";
import { account } from "./celo";
import { CHAIN_ID, TEXTILE_API } from "./config";

export interface Quote {
  rfqId: string;
  claimToken?: string;
  quote: {
    sellAmount: string;
    buyAmount: string;
    feeAmount: string;
    takerPays: string;
    expiresAt: string;
    reactor: Address;
  };
  transactions: {
    approval: { to: Address; data: Hex };
    swap: { to: Address; data: Hex };
  };
}

type Json = Record<string, any>;

const apiKey = () => process.env.TEXTILE_API_KEY;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = apiKey();
  return {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
    ...extra,
  };
}

/** Prueba de control de la wallet (EIP-712), solo si no hay API key. Vale ~60s. */
async function takerProof() {
  const nonce = bytesToHex(randomBytes(32));
  const issuedAt = Date.now();
  const signature = await account().signTypedData({
    domain: { name: "Textile Taker Control", version: "1", chainId: CHAIN_ID },
    types: {
      TakerControl: [
        { name: "taker", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "issuedAt", type: "uint256" },
      ],
    },
    primaryType: "TakerControl",
    message: { taker: account().address, chainId: BigInt(CHAIN_ID), nonce, issuedAt: BigInt(issuedAt) },
  });
  return { nonce, issuedAt, signature };
}

/** Pide una cotización firme (sin llenado parcial). Devuelve null si no hay liquidez. */
export async function requestQuote(sellToken: Address, buyToken: Address, sellAmount: bigint): Promise<Quote | null> {
  const body: Json = {
    chainId: CHAIN_ID,
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    taker: account().address,
  };
  if (!apiKey()) body.takerProof = await takerProof();

  const response = await fetch(`${TEXTILE_API}/rfq/request`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(75_000),
  });
  const json = (await response.json()) as Json;
  if (!response.ok) throw new Error(`Textile ${response.status}: ${JSON.stringify(json)}`);

  const data = json.data;
  if (data.status === "no_quote") {
    console.warn("[textile] no_quote:", data.reason);
    return null;
  }
  return {
    rfqId: data.rfqId,
    claimToken: data.claimToken,
    quote: data.quote,
    transactions: data.transactions,
  };
}

/** Informa el hash del swap a Textile (opcional: el settlement se detecta on-chain). */
export async function reportSubmit(q: Quote, txHash: Hex): Promise<void> {
  const extra: Record<string, string> = !apiKey() && q.claimToken ? { "X-Rfq-Claim": q.claimToken } : {};
  await fetch(`${TEXTILE_API}/rfq/${q.rfqId}/submit`, {
    method: "POST",
    headers: headers(extra),
    body: JSON.stringify({ txHash }),
  }).catch((error) => console.warn("[textile] submit falló (no bloqueante):", error));
}
