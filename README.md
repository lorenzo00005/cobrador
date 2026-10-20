# Cobrador 🇦🇷 — a collections agent that turns pesos into savings

> **Agents on Open Rails Hackathon · Stable Agents: LatAm (Ripio × Celo)**
>
> *Cobrador* ("the collector") is a Telegram agent for small Argentine sellers. Their customers pay in **pesos by
> bank transfer**, and the agent settles every payment on **Celo mainnet**: **wARS → USD₮** through Textile FX,
> sent straight to the seller's wallet. No exchange account, no manual conversion, no crypto knowledge needed.

## The problem

A seller in Argentina who sells on Instagram or WhatsApp gets paid by bank transfer in pesos. To protect that money
from inflation they have to log into an exchange, buy dollars, wait, and withdraw — every single time, paying
spread at each step. Most just don't, and lose value every week.

## What Cobrador does

The seller talks to the agent in plain Spanish on Telegram (illustrative conversation):

```
Seller:   Cobrale 15.000 a Juan por la remera
Cobrador: Listo, registré "remera" por $15.000.
          Que transfiera exactamente $15.000 a este CVU: <CVU de Ripio>
          ...
Cobrador: ✅ Ya recibí la plata de remera: $15.000 ARS.
          ↳ 💸 Ya mandé la plata de remera a tu wallet.
             <wARS> wARS → <USD₮> USD₮ · Swap: celoscan.io/tx/… · Envío: celoscan.io/tx/…
```

1. **Charge** — the agent registers the sale (product + amount) and hands out a payment destination: the seller's
   own Ripio **CVU** (Ripio Ramps API) or a `ramp.ripio.com` link with the amount prefilled.
2. **Detect** — Ripio converts the pesos to **wARS** and delivers them to the agent wallet on Celo. The agent learns
   about it twice: from the Ripio API when the pesos arrive (matched to the sale by exact amount) and on-chain when
   the wARS land.
3. **Settle** — fully in code, not by the LLM: RFQ quote on **Textile FX** (wARS → USD₮), swap, then transfer of the
   USD₮ to the seller's destination wallet.
4. **Report** — fixed-text Telegram notifications ("payment received" → reply "sent to your wallet" with Celoscan
   links), so amounts and hashes can never be hallucinated.

## Celo stack used

| Piece | How Cobrador uses it |
| - | - |
| **Ripio wARS** (Celo mainnet) | Every payment is received as wARS and settled from wARS. |
| **Ripio on-ramp** | `ramp.ripio.com` link (no credentials) and the **Ripio Ramps API** (customer, KYC, on-ramp session with a fixed CVU, order polling, signed webhooks). |
| **Textile FX** | RFQ swap wARS → USD₮ on Celo mainnet ([`agent/lib/textile.ts`](agent/lib/textile.ts)). |
| **Fee abstraction** | Gas is paid in **USD₮** through the USD₮ fee-currency adapter (`FEE_CURRENCY`): the agent wallet never needs CELO. |
| **ERC-8021 attribution** | Every transaction is tagged with the entry's attribution code (`ATTRIBUTION_CODE`, see [`agent/lib/celo.ts`](agent/lib/celo.ts)). |
| **ERC-8004 identity** | Agent **#9983** in the Celo Identity Registry, owned by the agent wallet ([registration file](agent-registration.json)). |

## Live on Celo mainnet

- Agent wallet: [`0x8b9a7c5D0B83e984061A989C76f035e81E1E55f3`](https://celoscan.io/address/0x8b9a7c5D0B83e984061A989C76f035e81E1E55f3)
- ERC-8004 registration: [`0x3f39d9e7…1783`](https://celoscan.io/tx/0x3f39d9e75f3739bd594681408975bb4e856ec5422184e652df39df0a06a61783)
- USD₮ settlements to the seller's wallet: [`0xaa26e99d…831c`](https://celoscan.io/tx/0xaa26e99d50c8299e915e25d7bafb10004086402afd6382cf5a1ef2c52096831c),
  [`0x7e0cd4d3…e389`](https://celoscan.io/tx/0x7e0cd4d3a652a1cb710bb427dc39eb8562215048df287fc6d420c37901b1e389)

## Guardrails

- **Owner only**: the Telegram channel drops every chat except `OWNER_TELEGRAM_CHAT_ID`.
- **Money moves in code, never by chat**: settlement runs deterministically on payment events; the LLM can only call
  tools, and the ones that move or redirect money (`cambiar_wallet_destino`, `reintentar_liquidacion`) require an
  explicit confirmation button.
- **Idempotent** by event (tx hash + log index, Ripio order + stage): a duplicated webhook never swaps twice.
- **Cap per settlement** (`MAX_SWAP_WARS`) and a USD₮ gas buffer so the final transfer never reverts.
- **Prompt-injection aware**: event data is treated as data, never as instructions.

## Architecture

```
 customer ──ARS transfer──▶ Ripio (CVU / ramp link) ──wARS──▶ agent wallet (Celo)
                                │                                 │
                     Ripio API / webhook                 on-chain scan (1/min)
                                ▼                                 ▼
                         "payment received"      Textile FX RFQ: wARS → USD₮ → seller wallet
                                └──────────── Telegram (owner) ◀──┘
```

| Path | What it is |
| - | - |
| `agent/instructions.md`, `agent/agent.ts` | Agent identity and model ([eve](https://eve.dev) framework, local `qwen3:8b` via Ollama). |
| `agent/tools/` | `registrar_venta`, `listar_ventas`, `obtener_alias_de_cobro`, `ver_estado`, `cambiar_wallet_destino`, `reintentar_liquidacion`, `simular_pago` (Ripio sandbox only). |
| `agent/lib/pipeline.ts` | Deterministic settlement: quote → approve → swap → transfer. |
| `agent/lib/deposits.ts` + `agent/schedules/escanear-depositos.ts` | On-chain wARS deposit scan. |
| `agent/lib/ripio.ts`, `agent/lib/ripio-orders.ts`, `agent/schedules/revisar-ripio.ts`, `agent/channels/ripio-webhook.ts` | Ripio Ramps API integration. |
| `agent/lib/store.ts` | Persistent state (sales, settlements, cursors). |

## Run it

Requirements: Docker, a Telegram bot token, and [Ollama](https://ollama.com) with `qwen3:8b` on the host.

```bash
cp .env.example .env      # fill in the agent key, attribution tag, Telegram and (optionally) Ripio credentials
docker compose up -d --build
```

`docker compose` starts the agent, a Cloudflare quick tunnel, and registers the Telegram webhook automatically.

**Ripio modes.** With `RIPIO_CLIENT_ID`, `RIPIO_CLIENT_SECRET` and `RIPIO_CUSTOMER_ID` set, the agent charges through
the seller's own CVU (Ripio Ramps API); otherwise it falls back to the `ramp.ripio.com` link. Ripio's sandbox only
delivers `RTEST` on Ethereum Sepolia, so in sandbox the agent reports the delivery and skips the Celo settlement; in
production (`RIPIO_ENV=production`) the wARS land on Celo and settle automatically. Try the sandbox from Telegram
with *"simulá un pago de 5000"*.

## What's next

- Production access to the Ripio Ramps API with Celo/wARS delivery, so every seller gets their own CVU.
- Multi-seller onboarding (one Ripio customer per seller, KYC through Ripio's hosted flow).
- Let the seller choose how much to keep in pesos (wARS) vs. dollars, and other wFIAT corridors (wBRL, wMXN…).

---

*Hecho en Argentina para vendedores argentinos.*
