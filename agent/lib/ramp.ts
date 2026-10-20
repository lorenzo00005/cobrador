import { account } from "./celo";

/**
 * Link al on-ramp de Ripio (ramp.ripio.com): no requiere credenciales ni KYB.
 * Formato documentado por Ripio para la hackathon:
 *   https://ramp.ripio.com/?country=AR&chain=42220&token=WARS&amount=10000&address=0x...
 * Con country + chain + token + amount el cliente va directo al flujo de pago; `address` es la wallet
 * del agente, que recibe los wARS en Celo. Los valores se pueden ajustar por env.
 */
export function rampUrl(montoArs?: number): string {
  const url = new URL(process.env.RAMP_BASE_URL ?? "https://ramp.ripio.com/");
  url.searchParams.set("country", process.env.RAMP_COUNTRY ?? "AR");
  url.searchParams.set("chain", process.env.RAMP_CHAIN ?? "42220"); // Celo mainnet
  url.searchParams.set("token", process.env.RAMP_TOKEN ?? "WARS");
  if (montoArs) url.searchParams.set("amount", String(Math.round(montoArs)));
  url.searchParams.set("address", account().address);
  return url.toString();
}
