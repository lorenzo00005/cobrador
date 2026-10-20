#!/bin/sh
# Espera la URL pública del túnel y registra el webhook de Telegram.
for i in $(seq 1 60); do
  URL=$(curl -s http://tunnel:2000/quicktunnel | sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p')
  [ -n "$URL" ] && break
  sleep 2
done
[ -z "$URL" ] && { echo "No pude obtener la URL del túnel"; exit 1; }
echo "URL pública:        https://$URL"
# esperar a que la app responda
for i in $(seq 1 90); do
  curl -s -o /dev/null "https://$URL/eve/v1/telegram" && break
  sleep 3
done
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://$URL/eve/v1/telegram\",\"secret_token\":\"$TELEGRAM_WEBHOOK_SECRET_TOKEN\",\"allowed_updates\":[\"message\",\"callback_query\"]}"
echo
