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
| Idempotência | Primeiro envio grava `alarm_sent_at` e `dose_alarm_receipts`. Repetições sobem `send_count` / `last_sent_at` com claim atômico (`ON CONFLICT`), no máximo a cada `ALARM_REPEAT_INTERVAL_MS` |
| Urgência / TTL | `urgency: 'high'`, `TTL` 3600, `topic: 'dose'` (o topic substitui push ainda não entregue) |
| Repetição | Até `ALARM_REPEAT_MAX` reenvios (padrão 3) a cada 2 min, enquanto a dose segue `pending` e `alarm_at <= now()`. Soneca apaga os receipts e recomeça; administrar ou pular tira a dose de `pending` |
| Preferências | Global (`caregivers.alarms_enabled`) + por tratamento; **sem** quiet hours de dose |
| Soneca | 1× 5 min (`snooze_count`) |
| Som in-app | Arquivo `web/public/sounds/alarm.wav` em loop, volume 1, com vibração; fallback Web Audio (dois tons, ganho ~1.0 via `DynamicsCompressor`) |
| Fallback | Banner + som in-app enquanto autenticado e dose `pending` |

## Consequências

- Sem VAPID configurado o servidor não envia push; a UI de Configurações mostra “indisponível”; o monitor in-app continua.
- iOS fora de `display-mode: standalone` bloqueia o botão Ativar e mostra o fluxo Safari → Home Screen.
- Endpoints 404/410 removem a subscription; falhas repetidas (≥10) também.
- MVP com uma réplica: claim atômico evita double push.
- O push de dose sai com urgência alta. O som com o app fechado continua sendo o do canal de notificação do Android, não o arquivo de alarme.

## Atualização — som e repetição (2026-11-02)

O alarme in-app ficou mais alto (arquivo em loop + vibração; Web Audio só se o arquivo não tocar). O scheduler reenvia o push da dose não confirmada. Isso não transforma o Web Push em despertador.

Limitações:

- Com o app fechado (ou em segundo plano no Android), o service worker só pode chamar `showNotification`. A API de notificação **não** aceita um arquivo de áudio nem um loop. `silent: false`, `vibrate`, `renotify` e `requireInteraction` pedem um alerta; o toque e o volume vêm do canal do site/PWA em Ajustes → Apps → Chrome ou Medica Certo → Notificações (Alerta/Som, importância alta, tela de bloqueio). Bateria em “Sem restrições” evita que o Android atrase o push.
- O canal é criado pelo sistema na primeira notificação. Mudar o padrão de vibração no service worker não reconfigura um canal que o usuário já silenciou.
- Não há botões “Tomei” / “Soneca” na notificação. O payload é genérico (sem id da dose, várias doses no mesmo push) e `notificationclick` só foca o app. Um botão desses pareceria registrar a dose sem fazê-lo.
- Um despertador de verdade — som em loop com o processo morto, tela cheia por cima da tela de bloqueio — exigiria um wrapper nativo Android (Capacitor ou TWA com full-screen intent e um canal do tipo alarme). Fora do escopo desta webapp.

## Alternativas rejeitadas

- Só `Notification` na aba aberta — não cobre app fechado.
- FCM/APNs nativos — fora do escopo web MVP.
- Quiet hours iguais ao zap-resumos — doses noturnas (ex.: antibiótico) devem alarmar (KD15).

## Referências

- `docs/design.md` § Notificações / alarmes (R8)
- `zap-resumos/docs/app/15-notificacoes.md`, `zap-resumos/public/sw.js`
