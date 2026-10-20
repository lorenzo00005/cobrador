import { defineSchedule } from "eve/schedules";
import { syncRipioOrders } from "../lib/ripio-orders";

/** Cada minuto revisa las órdenes de on-ramp en Ripio (no hace nada sin credenciales de la API). */
export default defineSchedule({
  cron: "* * * * *",
  async run({ waitUntil }) {
    waitUntil(syncRipioOrders().catch((e) => console.error("[ripio] error:", e)));
  },
});
