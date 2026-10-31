# ADR 002 — Web Push / PWA para alarmes de dose

| Campo | Valor |
|---|---|
| Status | Aceito |
| Data | 2026-04-07 |
| Decisores | Design MVP (`docs/design.md` R8, KD3, KD15); padrão operacional `zap-resumos` |

## Contexto

O cuidador precisa de alarmes mesmo com o app fechado, no lugar dos despertadores manuais do SO. O alvo é webapp (sem app nativo). iOS só entrega Web Push para PWAs adicionados à Tela de Início (Safari, iOS ≥ 16.4).

## Decisão

| Tema | Escolha |
|---|---|
| Transporte | Web Push + VAPID (`web-push` npm) |
| Chaves | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` no ambiente |
| Subscribe | `userVisibleOnly: true` obrigatório; só após gesto (“Ativar neste aparelho”) |
| Service Worker | `web/public/sw.js`; no `push` **sempre** `showNotification` no iOS; em desktop com janela focada, `postMessage` in-app (sem duplicar toast de sistema) |
| Payload | Genérico (“Hora do medicamento”); sem nome de paciente/medicamento |
| Antecipação | `alarm_at = scheduled_at − 5 min` |
| Idempotência | Claim `alarm_sent_at` no scheduler |
| Preferências | Global (`caregivers.alarms_enabled`) + por tratamento; **sem** quiet hours de dose |
| Soneca | 1× 5 min (`snooze_count`) |
| Fallback | Banner + som in-app enquanto autenticado e dose `pending` |

## Consequências

- Sem VAPID configurado o servidor não envia push; a UI de Configurações mostra “indisponível”; o monitor in-app continua.
- iOS fora de `display-mode: standalone` bloqueia o botão Ativar e mostra o fluxo Safari → Home Screen.
- Endpoints 404/410 removem a subscription; falhas repetidas (≥10) também.
- MVP com uma réplica: claim atômico evita double push.

## Alternativas rejeitadas

- Só `Notification` na aba aberta — não cobre app fechado.
- FCM/APNs nativos — fora do escopo web MVP.
- Quiet hours iguais ao zap-resumos — doses noturnas (ex.: antibiótico) devem alarmar (KD15).

## Referências

- `docs/design.md` § Notificações / alarmes (R8)
- `zap-resumos/docs/app/15-notificacoes.md`, `zap-resumos/public/sw.js`
