// DIAGNÓSTICO (solo lectura): pide una cotización RFQ a Textile FX para wARS -> USD₮.
// No envía ninguna transacción on-chain. Solo firma un takerProof EIP-712 (prueba de control) y consulta precio.
import { randomBytes } from "node:crypto";
import { bytesToHex, createPublicClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const CHAIN_ID = 42220;
const TEXTILE_API = "https://api.textilecredit.com/v2";
const WARS = getAddress("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D");
const USDT = getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e");

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
const rpc = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const pc = createPublicClient({ chain: celo, transport: http(rpc) });

const bal = await pc.readContract({ address: WARS, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
const cap = BigInt(process.env.MAX_SWAP_WARS ?? "500000") * 10n ** 18n;
const sellAmount = bal > cap ? cap : bal;
console.log("wARS a vender:", formatUnits(sellAmount, 18));

const key = process.env.TEXTILE_API_KEY;
const body = { chainId: CHAIN_ID, sellToken: WARS, buyToken: USDT, sellAmount: sellAmount.toString(), taker: account.address };
if (!key) {
  const nonce = bytesToHex(randomBytes(32));
  const issuedAt = Date.now();
  const signature = await account.signTypedData({
    domain: { name: "Textile Taker Control", version: "1", chainId: CHAIN_ID },
    types: { TakerControl: [
      { name: "taker", type: "address" }, { name: "chainId", type: "uint256" },
      { name: "nonce", type: "bytes32" }, { name: "issuedAt", type: "uint256" } ] },
    primaryType: "TakerControl",
    message: { taker: account.address, chainId: BigInt(CHAIN_ID), nonce, issuedAt: BigInt(issuedAt) },
  });
  body.takerProof = { nonce, issuedAt, signature };
}

const res = await fetch(`${TEXTILE_API}/rfq/request`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(75_000),
});
const json = await res.json();
console.log("HTTP", res.status);
if (!res.ok) { console.log("ERROR:", JSON.stringify(json)); process.exit(1); }
const d = json.data ?? {};
if (d.status === "no_quote") { console.log("NO_QUOTE. motivo:", d.reason); process.exit(0); }
console.log("COTIZACION OK:");
console.log("  buyAmount (USD₮):", d.quote ? formatUnits(BigInt(d.quote.buyAmount), 6) : "?");
console.log("  expiresAt:", d.quote?.expiresAt);
console.log("  reactor:", d.quote?.reactor);
