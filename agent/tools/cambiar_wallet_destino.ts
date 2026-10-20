import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { isAddress } from "viem";
import { z } from "zod";
import { getDestination, setDestination } from "../lib/store";

export default defineTool({
  description:
    "Cambia la wallet de destino final (la cuenta de Ripio u otra) a la que se envían los USD₮ de cada liquidación. " +
    "Requiere confirmación explícita del dueño con un botón.",
  inputSchema: z.object({
    address: z.string().refine(isAddress, "Dirección EVM inválida (debe empezar con 0x y tener 42 caracteres)"),
  }),
  approval: always(),
  async execute({ address }) {
    const anterior = (await getDestination()) ?? null;
    const nueva = await setDestination(address);
    return { anterior, nueva };
  },
});
