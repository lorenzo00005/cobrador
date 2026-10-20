import { getAddress, type Address } from "viem";

/** Celo mainnet (el único chain que cuenta en la hackathon). */
export const CHAIN_ID = 42220;

/** Tokens en Celo (fuente: address book de Textile FX). */
export const WARS: Address = getAddress("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D"); // 18 decimales
export const USDT: Address = getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"); // 6 decimales
export const WARS_DECIMALS = 18;
export const USDT_DECIMALS = 6;

export const TEXTILE_API = "https://api.textilecredit.com/v2";

export function env(name: string, required = true): string {
  const value = process.env[name];
  if (!value && required) throw new Error(`Falta la variable de entorno ${name}`);
  return value ?? "";
}

export const ripioBase = () =>
  process.env.RIPIO_ENV === "production" ? "https://skala.ripio.com" : "https://skala-sandbox.ripio.com";

export const ripioSandbox = () => process.env.RIPIO_ENV !== "production";

/** La API de Ramps se usa solo si están las credenciales y el customer; si no, queda el link de ramp.ripio.com. */
export const ripioEnabled = () =>
  Boolean(process.env.RIPIO_CLIENT_ID && process.env.RIPIO_CLIENT_SECRET && process.env.RIPIO_CUSTOMER_ID);

/**
 * Red y token que entrega Ripio. El sandbox solo ofrece ETHEREUM_SEPOLIA / RTEST (token de prueba);
 * en producción, confirmar los nombres con GET /api/v1/depositNetworks/.
 */
export const ripioChain = () => process.env.RIPIO_CHAIN || (ripioSandbox() ? "ETHEREUM_SEPOLIA" : "CELO");
export const ripioCurrency = () => process.env.RIPIO_CURRENCY || (ripioSandbox() ? "RTEST" : "WARS");

/** Solo las entregas en Celo terminan en wARS on-chain que el agente puede liquidar. */
export const ripioDeliversOnCelo = (chain: string) => chain.toUpperCase().includes("CELO");

/** Tope de seguridad por liquidación, en wARS (unidades enteras). */
export const maxSwapWars = () => Number(process.env.MAX_SWAP_WARS ?? "500000");
