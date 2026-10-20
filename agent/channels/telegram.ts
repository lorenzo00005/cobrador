import { defaultTelegramAuth, telegramChannel } from "eve/channels/telegram";
import { sendOwnerMessage } from "../lib/telegram";

/**
 * Solo el dueño (OWNER_TELEGRAM_CHAT_ID) puede hablarle al agente.
 * Cualquier otro chat se descarta: nadie más puede cambiar la wallet destino.
 *
 * Solo pasa texto: el modelo local no acepta imágenes, y una foto o archivo en el historial
 * hace fallar todos los turnos siguientes de la conversación.
 */
export default telegramChannel({
  botUsername: process.env.TELEGRAM_BOT_USERNAME ?? "cobrador_bot",
  onMessage(_ctx, message) {
    if (String(message.chat.id) !== process.env.OWNER_TELEGRAM_CHAT_ID) return null;
    if (!message.text) {
      void sendOwnerMessage("Por ahora solo leo mensajes de texto. Escribime lo que necesitás 🙂");
      return null;
    }
    return { auth: defaultTelegramAuth(message) };
  },
});
