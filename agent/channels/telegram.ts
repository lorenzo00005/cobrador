import { defaultTelegramAuth, telegramChannel } from "eve/channels/telegram";

/**
 * Solo el dueño (OWNER_TELEGRAM_CHAT_ID) puede hablarle al agente.
 * Cualquier otro chat se descarta: nadie más puede cambiar la wallet destino.
 */
export default telegramChannel({
  botUsername: process.env.TELEGRAM_BOT_USERNAME ?? "cobrador_bot",
  onMessage(_ctx, message) {
    if (String(message.chat.id) !== process.env.OWNER_TELEGRAM_CHAT_ID) return null;
    return { auth: defaultTelegramAuth(message) };
  },
});
