import { defineSchedule } from "eve/schedules";
import { scanDeposits } from "../lib/deposits";

/** Cada minuto busca wARS nuevos en la wallet del agente. */
export default defineSchedule({
  cron: "* * * * *",
  async run({ waitUntil }) {
    waitUntil(scanDeposits().catch((e) => console.error("[deposits] error:", e)));
  },
});
