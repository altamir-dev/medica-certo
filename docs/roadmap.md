# Roadmap — Medica Certo

Roadmap de entrega alinhado a `docs/prd.md` e ao glossário em `CONTEXT.md`.  
Prazos são **relativos** (fases), não datas de calendário — ajustar quando o design e a stack forem fechados.

## Norte do produto

Substituir a folha de papel e os despertadores manuais: o cuidador vê as próximas doses, marca administrações e recebe alarmes no webapp.

```text
Folha + despertadores  →  MVP utilizável no dia a dia  →  Multi-cuidador e extras
```

## Visão por fases

| Fase | Nome | Resultado para o cuidador | Status |
|---|---|---|---|
| 0 | Fundação | PRD validado + design aprovado + projeto sobe | PR1–PR6 prontos — próximo: deploy VPS / PR7 |
| 1 | Identidade e cadastros | Login; cadastra pacientes e medicamentos | Auth + pacientes + medicamentos prontos |
| 2 | Tratamento e grade | Configura esquema e vê a grade (substitui a folha) | PR5+PR6 prontos |
| 3 | Dia a dia | Dashboard + marcar dose / pular (substitui o X) | Pendente |
| 4 | Alarmes | Notificações no app (substitui despertadores) | Pendente |
| 5 | Endurecimento MVP | Uso real estável; critérios do PRD atendidos | Pendente |
| 6+ | Pós-MVP | Compartilhamento, exportação, estoque, etc. | Depois |

**MVP completo** = fim da Fase 5.

---

## Fase 0 — Fundação

**Objetivo:** poder implementar sem reabrir o “o quê”.

| Item | Entrega | Ref. |
|---|---|---|
| 0.1 | Validar PRD (2 rodadas: refino + bate com objetivo) | `docs/prd.md` |
| 0.2 | Design: arquitetura, modelo de dados, APIs, UI | skill de design |
| 0.3 | Fechar decisões em aberto do PRD (auth, janela rolante, antecipação do alarme) | PRD § decisões em aberto |
| 0.4 | Bootstrap do repositório (app, CI mínimo, ambiente) | — |
| 0.5 | ADRs das escolhas difíceis de reverter (stack, auth, push) | `docs/adr/` |

**Critério de saída:** design aprovado; glossário estável; primeiro deploy/dev rodando.

---

## Fase 1 — Identidade e cadastros

**Objetivo:** cuidador entra e mantém a base (pacientes + catálogo).

| Item | Entrega | Requisitos |
|---|---|---|
| 1.1 | Login / logout / rotas protegidas | R1 |
| 1.2 | CRUD de paciente (nome, nascimento, janela de sono) | R2 |
| 1.3 | CRUD de medicamento + busca | R3 |
| 1.4 | Fluxo “não achou → cadastrar” | R3 |

**Critério de saída:** cuidador autenticado lista/edita pacientes e medicamentos; isolamento por cuidador.

**Demo:** cadastrar 2 pacientes e 3 medicamentos da folha de papel (ex.: Ceftriaxona, Prednisolona).

---

## Fase 2 — Tratamento e grade

**Objetivo:** a folha passa a existir no sistema.

| Item | Entrega | Requisitos |
|---|---|---|
| 2.1 | Criar/editar/encerrar tratamento (quantidade, via, início, fim opcional) | R4 |
| 2.2 | Esquema **intervalo regular** (a cada N h) + geração da grade | R4 |
| 2.3 | Esquema **horários customizados** (lista do dia) + geração | R4 |
| 2.4 | Sugestão de 1ª dose respeitando janela de sono + pré-visualização | R5 |
| 2.5 | Tratamento contínuo (sem fim) com janela rolante | R4 |
| 2.6 | Atalho “encerrar e recriar” (mudança de esquema) | R4 |
| 2.7 | Tela da grade do tratamento (visão temporal + status) | R6 |

**Critério de saída:** dá para reproduzir um período da folha (ex.: De 14/09 até 27/09) com vários medicamentos e ver a grade.

**Demo:** montar Prednisolona em horários customizados e um antibiótico 8/8h com sugestão sem madrugada.

---

## Fase 3 — Dia a dia (dashboard e registro)

**Objetivo:** o X do papel vira registro no app.

| Item | Entrega | Requisitos |
|---|---|---|
| 3.1 | Dashboard: data/hora atual + próximas doses (todos os pacientes) | R6 |
| 3.2 | Destaque de doses pendentes atrasadas | R6 |
| 3.3 | Marcar administrada (hora efetiva editável) | R7 |
| 3.4 | Marcar pulada; manter pendente | R7 |
| 3.5 | Anotações em dose ou tratamento | R7 |
| 3.6 | Registro rápido a partir do dashboard | Telas MVP |

**Critério de saída:** um dia típico (várias doses, atraso, pulada) fica registrado só pelo app.

**Demo:** percorrer manhã/tarde da folha marcando X digitais com hora.

---

## Fase 4 — Alarmes

**Objetivo:** acabar com despertadores manuais para tratamentos ativos.

| Item | Entrega | Requisitos |
|---|---|---|
| 4.1 | Permissão de notificação + fallback se negada | R8 |
| 4.2 | Disparo próximo do horário da dose prevista | R8 |
| 4.3 | Ação rápida: administrada / pulada a partir do alarme | R8 |
| 4.4 | Cancelar alarme se já administrada/pulada | R8 |
| 4.5 | Preferência: desligar alarmes global ou por tratamento | R8 |

**Critério de saída:** cuidador opera um dia sem criar despertador no SO para os tratamentos do app.

**Demo:** agendar dose em poucos minutos, receber alarme, marcar administrada.

---

## Fase 5 — Endurecimento do MVP

**Objetivo:** uso real confiável; fechar o MVP.

| Item | Entrega |
|---|---|
| 5.1 | Testes dos fluxos críticos (auth, grade, registro, alarme) |
| 5.2 | Ajustes mobile (viewport do cuidador no celular) |
| 5.3 | Estados vazios, erros e permissões cobertos |
| 5.4 | Validação contra critérios de aceite do PRD (R1–R8) |
| 5.5 | Migração assistida: passar 1 folha real inteira para o app |

**Critério de saída (MVP done):**

- Configurar tratamento e ver grade no mesmo dia.
- Registrar administrações no lugar do papel.
- Alarmes do app em uso nos tratamentos ativos.
- Métricas de orientação do PRD observáveis em uso piloto.

---

## Fase 6+ — Pós-MVP (backlog ordenado)

Ordem sugerida; reordenar após o piloto.

| Prioridade | Tema | Valor |
|---|---|---|
| P1 | Compartilhamento entre cuidadores (mesmo paciente) | Casal/família medicando juntos |
| P2 | Exportar grade / histórico (PDF ou imagem “tipo folha”) | Backup e conversa com profissional de saúde |
| P3 | Antecipação/soneca avançada e resumo do dia | Menos atrito nos alarmes |
| P4 | PWA instalável / melhor suporte offline leve | Uso em casa com rede instável |
| P5 | Controle simples de estoque/frascos | “Sobra de 2 dias” estruturado |
| P6 | Relatórios de adesão (doses dadas vs previstas) | Acompanhar falhas |
| P7 | Paciente como visualizador (somente leitura) | Transparência sem poder marcar dose |
| P8 | Integrações (receita, farmácia, prontuário) | Só com demanda clara |

Itens explicitamente fora do MVP no PRD permanecem aqui até haver pedido explícito.

---

## Dependências entre fases

```text
Fase 0
  └─► Fase 1 (auth + cadastros)
        └─► Fase 2 (tratamento + grade)
              └─► Fase 3 (dashboard + registro)
                    └─► Fase 4 (alarmes)
                          └─► Fase 5 (endurecimento)  =  MVP
                                └─► Fase 6+ (pós-MVP)
```

Fase 4 pode iniciar em paralelo o spike de Web Push/PWA assim que a Fase 0 fechar a decisão de notificações — a integração de produto depende da Fase 3.

---

## Marcos de verificação

| Marco | Como validar |
|---|---|
| M1 — Folha digital | Reproduzir um período real da `IMG_3313` na grade |
| M2 — Dia sem papel | Um dia inteiro só com dashboard + registro |
| M3 — Dia sem despertador do SO | Mesmo dia com alarmes do app |
| M4 — MVP piloto | Uma semana de uso real; lista de gaps para Fase 6+ |

---

## Riscos e contornos

| Risco | Impacto | Contorno |
|---|---|---|
| Notificações limitadas no browser/iOS | Fase 4 fraca | Spike cedo (Fase 0/4); PWA; fallback com lista “atrasadas” gritante no dashboard |
| Sugestão de horário ruim (8/8h vs sono) | Desconfiança na grade | Aviso explícito + ajuste manual da 1ª dose (já no PRD) |
| Escopo creeping (estoque, receita, multi-user) | Atrasa MVP | Manter Fase 6+; só entra com marco M4 feito |
| Mudança de esquema mal usada | Histórico confuso | UX de “encerrar e recriar” bem visível |

---

## Próxima ação imediata

1. ~~Rodada de validação do PRD~~ → `docs/prd.md`
2. ~~Documento de design~~ → `docs/design.md` (aprovado no loop writer/reviewer; UI com CSS variables; host `medica-certo.altamir.dev`)
3. ~~**PR1 — Bootstrap**~~ monorepo + casco visual em localhost (`npm run dev`; host alvo `medica-certo.altamir.dev`)
4. ~~**PR2 — Auth**~~ e-mail/senha + sessão cookie (`docs/adr/003-auth-session.md`)
5. ~~**PR3 — Pacientes**~~ CRUD + UI `/pacientes` (R2)
6. ~~**PR4 — Medicamentos**~~ CRUD + busca + foto + fluxo “não achou → cadastrar” (R3 / 1.3–1.4)
7. ~~**PR5+PR6 — Tratamento e grade**~~ domínio/API + UI a partir do paciente (R4–R6); toggle de alarmes
8. Em seguida deploy VPS e **PR7** (dashboard + registro de dose); fases 3–5 conforme o plano de PRs
