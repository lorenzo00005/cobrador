import { toDataSuffix } from "@celo/attribution-tags";
import {
  concat,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { env } from "./config";

export const account = () => privateKeyToAccount(env("AGENT_PRIVATE_KEY") as Hex);

const transport = () => http(process.env.CELO_RPC_URL ?? "https://forno.celo.org");

export const publicClient = createPublicClient({ chain: celo, transport: transport() });

export const walletClient = () => createWalletClient({ account: account(), chain: celo, transport: transport() });

/**
 * Tag ERC-8021 que acredita cada transacción en la hackathon. Se agrega al calldata en el
 * cliente de la wallet (nunca en el contrato) y NO se puede agregar retroactivamente,
 * así que sin tag configurado el agente se niega a enviar nada.
 */
function attributionSuffix(): Hex | undefined {
  const code = process.env.ATTRIBUTION_CODE;
  if (code) return toDataSuffix(code) as Hex;
  if (process.env.ALLOW_UNTAGGED === "1") return undefined;
  throw new Error(
    "Falta ATTRIBUTION_CODE (el tag ERC-8021 que te da Loops House al inscribirte). " +
      "Sin tag la transacción no se acredita; seteá ALLOW_UNTAGGED=1 solo para pruebas.",
  );
}

/** Envía una transacción con el tag de atribución y espera su confirmación. */
export async function sendTagged(tx: { to: Address; data: Hex }): Promise<Hex> {
  const suffix = attributionSuffix();
  const data = suffix ? concat([tx.data, suffix]) : tx.data;
  const feeCurrency = process.env.FEE_CURRENCY as Address | undefined; // adaptador USDT/USDC para pagar gas en stablecoin
  const hash = await walletClient().sendTransaction({
    to: tx.to,
    data,
    value: 0n,
    ...(feeCurrency ? { feeCurrency } : {}),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`La transacción ${hash} revirtió`);
  return hash;
}

export const balanceOf = (token: Address, owner: Address) =>
  publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });

export const allowanceOf = (token: Address, owner: Address, spender: Address) =>
  publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });

export const transferData = (to: Address, amount: bigint) =>
  encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });
