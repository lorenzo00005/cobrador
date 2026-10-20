import { defineChannel, POST } from "eve/channels";
import { verifySignature } from "../lib/ripio";
import { syncRipioOrders } from "../lib/ripio-orders";

/**
 * Webhook de Ripio Ramps: https://<tu-app>/webhooks/ripio (la URL se la pedís al equipo de Ripio,
 * que te da el secreto compartido → RIPIO_WEBHOOK_SECRET).
 * No confía en el contenido del evento: verifica la firma y dispara la misma revisión de órdenes
 * que corre cada minuto, así el aviso llega al instante y la lógica queda en un solo lugar.
 */
export default defineChannel({
  turnPolicy: "queue",
  routes: [
    POST("/webhooks/ripio", async (request, { waitUntil }) => {
      if (!process.env.RIPIO_WEBHOOK_SECRET) return new Response("webhook no configurado", { status: 404 });

      const raw = await request.text();
      if (!verifySignature(raw, request.headers.get("Http-X-Wh-Signature-256"))) {
        return new Response("firma inválida", { status: 403 });
      }

      waitUntil(syncRipioOrders().catch((e) => console.error("[ripio] webhook:", e)));
      // Ripio pide 2xx rápido; la revisión corre en waitUntil.
      return new Response(null, { status: 200 });
    }),
  ],
});
