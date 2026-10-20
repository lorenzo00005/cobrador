import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";
import { listSales } from "../lib/store";

export default defineTool({
  description: "Lista las últimas ventas registradas con su estado: pendiente (esperando pago), cobrada o liquidada.",
  inputSchema: z.object({ limite: z.number().int().min(1).max(50).default(10) }),
  approval: never(),
  async execute({ limite }) {
    return { ventas: await listSales(limite) };
  },
});
