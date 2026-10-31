# SPEC: Tratamento + Grade de doses (PR5 + PR6)

## Overview

Permitir que o **Cuidador** vincule um **Paciente** a um **Medicamento** por meio de um **Tratamento**, com **Esquema de horários** (intervalo regular ou horários customizados), sugestão de 1ª dose sensível à **Janela de sono**, flag de alarmes e visualização da **Grade de doses**.

Critério de “pronto” (fluxo E2E): cuidador acessa um paciente → adiciona medicamento → pesquisa/cadastra medicamento → informa quantidade da dose (posologia do tratamento) e via → escolhe intervalo regular ou horários customizados → ativa alarmes → salva → vê a grade.

## User Roles

- **Cuidador**: único ator autenticado no MVP.

## Escopo desta fatia

- R4 (Tratamento e esquema), R5 (sugestão 1ª dose), R6 (grade do tratamento — visão temporal).
- Entrada do fluxo **a partir do Paciente**.
- Ambos os modos de esquema; curso com `endsOn` e tratamento contínuo.
- Toggle **alarmes ativos** no tratamento (`alarmsEnabled`, default true). Persistência apenas; disparo Web Push fica fora (PR8/PR9).

## Fora de escopo

- Registrar dose administrada / pulada (R7 / PR7).
- Dashboard de próximas doses (PR7).
- Web Push / PWA / scheduler de alarmes (PR8/PR9).
- Anotações.
- Autocomplete de catálogo externo ANVISA (spike separado).
- Compartilhamento multi-cuidador.

## Requirements

### REQ-1 — Criar Tratamento

**User Story:** Como cuidador, quero vincular um medicamento a um paciente com início, quantidade, via e esquema, para gerar a grade de doses.

**Acceptance Criteria:**

1. WHEN o cuidador cria um tratamento com paciente, medicamento, `startsAt`, `doseQuantity`, `route` e modo de esquema válidos THEN o sistema SHALL persistir o tratamento `active` e materializar as doses previstas.
2. WHEN o modo é `regular_interval` THEN o sistema SHALL exigir `intervalHours` > 0 e gerar doses a cada N horas a partir de `startsAt`.
3. WHEN o modo é `custom_times` THEN o sistema SHALL exigir lista de ≥ 1 horário do dia, ordenar, rejeitar duplicatas (`DUPLICATE_TIME`) e gerar uma dose por horário em cada dia do período.
4. WHEN `endsOn` é informado THEN o sistema SHALL gerar a grade completa até o fim inclusivo desse dia (America/Sao_Paulo), sem cap de 7 dias.
5. WHEN `endsOn` é omitido (contínuo) THEN o sistema SHALL materializar de `range_start` até `max(startsAt, now) + 7 dias`, com cap de backfill de 31 dias.
6. WHEN o curso tem `endsOn` THEN o sistema SHALL materializar a grade completa do `startsAt` ao fim do dia `endsOn` (sem cap de 31 dias — migração de folhas antigas).
7. IF paciente ou medicamento não pertencer ao cuidador THEN o sistema SHALL responder 404.
8. IF curso com `endsOn − startsAt` > 366 dias THEN o sistema SHALL rejeitar (400).
9. WHEN o cuidador define `alarmsEnabled` THEN o sistema SHALL persistir o valor (default `true`).

**Edge Cases:**

- Lista custom desordenada → ordenar na API.
- Horário duplicado → 400 `DUPLICATE_TIME`.
- Medicamento inexistente no fluxo → redirecionar ao cadastro com `returnTo` e retornar ao tratamento.

### REQ-2 — Preview e sugestão de 1ª dose

**User Story:** Como cuidador, quero pré-visualizar a grade e obter sugestão de 1ª dose (intervalo regular) que minimize doses na janela de sono.

**Acceptance Criteria:**

1. WHEN o cuidador solicita preview THEN o sistema SHALL retornar a lista de `scheduledAt` com as mesmas regras de create, sem persistir.
2. WHEN o modo é `regular_interval` e o cuidador solicita sugestão THEN o sistema SHALL propor `firstDoseAt` no dia âncora minimizando hits na janela de sono (algoritmo do design.md / R5).
3. WHEN a melhor sugestão ainda tem hits no sono THEN o sistema SHALL retornar `warning: true`.
4. WHEN o modo é `custom_times` THEN o sistema SHALL não oferecer sugestão automática de 1ª dose.

### REQ-3 — Grade do tratamento

**User Story:** Como cuidador, quero ver a grade de doses do tratamento, para saber o que dar e quando.

**Acceptance Criteria:**

1. WHEN o cuidador abre a grade THEN o sistema SHALL listar doses do tratamento no intervalo `from`/`to` (default: janela gerada).
2. WHEN a dose está `pending` e `scheduledAt` < agora THEN a UI SHALL marcá-la como atrasada (Tag `error`).
3. WHEN o tratamento é contínuo e `generated_until` ≤ 48h no futuro THEN o sistema SHALL estender +7 dias de forma idempotente ao abrir a grade.

### REQ-4 — Encerrar e mudança de esquema

**User Story:** Como cuidador, quero encerrar um tratamento (e opcionalmente recriar com outro esquema).

**Acceptance Criteria:**

1. WHEN o cuidador encerra THEN o sistema SHALL marcar `status=ended`, `ended_at=now` e cancelar doses `pending` futuras.
2. WHEN o cuidador tenta PATCH de campos de esquema (`scheduleMode`, `intervalHours`, `timesOfDay`, `startsAt`) THEN o sistema SHALL responder 400 `CONFLICT` (exigir encerrar + recriar).
3. WHEN o cuidador usa “encerrar e recriar” THEN a UI SHALL pré-preencher paciente, medicamento, quantidade e via.

### REQ-5 — Fluxo UI a partir do Paciente

**User Story:** Como cuidador, quero iniciar o vínculo a partir do paciente.

**Acceptance Criteria:**

1. WHEN o cuidador abre um paciente THEN o sistema SHALL listar tratamentos desse paciente e oferecer “Adicionar medicamento”.
2. WHEN o medicamento não existe THEN o sistema SHALL permitir cadastrá-lo e retornar ao formulário do tratamento (`returnTo`).
3. WHEN o tratamento é salvo THEN o sistema SHALL navegar para a grade do tratamento.
4. WHEN o cuidador ativa/desativa alarmes no formulário THEN o valor SHALL ser enviado e persistido.

### REQ-6 — Isolamento e delete de paciente

1. IF cuidador não autenticado THEN o sistema SHALL negar (401).
2. WHEN cuidador tenta DELETE de paciente com tratamento `active` THEN o sistema SHALL responder 409 `CONFLICT` (KD21).

## Non-Functional

- Timezone fixo MVP: America/Sao_Paulo; storage `timestamptz` UTC.
- UI: CSS variables + portal shell; Tags só variantes existentes (`error` para atrasada).
- Isolamento por `caregiver_id` em todas as queries.
- Testes unitários da geração de grade e sugestão (golden N=8 → 07:00).

## Decisões do grilling

| Tema | Decisão |
|---|---|
| Escopo | Tratamento + grade + sugestão; sem registro de dose |
| Entrada | A partir do Paciente |
| Modos | Intervalo regular + horários customizados |
| Período | Contínuo e com `endsOn` |
| Alarmes nesta fatia | Toggle `alarmsEnabled` only |
| PR4 | Commitado antes desta fatia |

## Validação da SPEC (2 rodadas)

### Rodada 1 — Completude vs objetivo

Objetivo do usuário: vínculo Paciente × Medicamento × Horários e grade, fluxo até ver a grade com alarmes ativáveis.

- Cobertura: REQ-1..5 atendem o fluxo E2E declarado.
- Lacuna aceita: disparo real de alarme (PR9); toggle satisfaz “ativa alarmes” no formulário.
- Lacuna aceita: marcar administrada (Fase 3).

**Resultado:** SPEC atende o objetivo da fatia.

### Rodada 2 — Consistência com PRD/design/CONTEXT

- Termos alinhados a CONTEXT.md (Tratamento, Esquema, Grade, Dose prevista).
- Regras alinhadas a design.md (KD2, KD13, KD14, KD21, algoritmos R4/R5).
- Sem contradição com ADR 001 (stack) e 003 (auth).

**Resultado:** aprovada para design/implementação.

## Próximo passo

Implementar conforme `docs/design.md` (PR5 domínio/API + PR6 UI), effort 5.
