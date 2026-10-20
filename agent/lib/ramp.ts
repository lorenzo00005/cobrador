import { account } from "./celo";

/**
 * Link al on-ramp de Ripio (ramp.ripio.com): no requiere credenciales ni KYB.
 * Con country + chain + token + amount el cliente salta el formulario; `address` es la wallet
 * del agente, que recibe los wARS. Los valores exactos se pueden ajustar por env.
 */
export function rampUrl(montoArs?: number): string {
  const url = new URL(process.env.RAMP_BASE_URL ?? "https://ramp.ripio.com/");
  url.searchParams.set("country", process.env.RAMP_COUNTRY ?? "AR");
  url.searchParams.set("chain", process.env.RAMP_CHAIN ?? "celo");
  url.searchParams.set("token", process.env.RAMP_TOKEN ?? "wARS");
  if (montoArs) url.searchParams.set("amount", String(montoArs));
  url.searchParams.set("address", account().address);
  return url.toString();
}
