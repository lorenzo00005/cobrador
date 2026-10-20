import { env } from "./config";

/**
 * Envía un mensaje de texto fijo al dueño por la Bot API de Telegram.
 * Los avisos de dinero van con texto determinístico (no redactado por el LLM) para que
 * nunca se inventen montos, productos ni hashes.
 * Devuelve el message_id; con `replyTo` el mensaje queda encadenado al anterior en el mismo chat.
 */
export async function sendOwnerMessage(text: string, replyTo?: number): Promise<number | undefined> {
  const response = await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env("OWNER_TELEGRAM_CHAT_ID"),
      text,
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    }),
  });
  const json = (await response.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
  if (!json.ok) {
    console.error("[telegram] sendMessage falló:", json.description);
    return undefined;
  }
  return json.result?.message_id;
}
