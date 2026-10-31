# SPEC: Grade estilo folha no paciente

## Objetivo

Ao abrir um paciente, o cuidador vê uma **tabela tipo folha de papel**:
- **Cabeçalho:** nome do medicamento (+ quantidade/via/esquema) e, abaixo, as **horas** (slots do dia).
- **Lateral:** **dias** (data civil).
- **Célula:** se administrada → **carimbo com horário efetivo**; se não → em branco; a **próxima** dose pendente fica **destacada**.
- **Clique na célula** (dose pendente ou já administrada): modal com data/hora, confirmação e observação.

## Acceptance (EARS)

1. WHEN o cuidador abre o paciente com ≥1 tratamento ativo THEN o sistema SHALL exibir a grade dias × slots.
2. WHEN a dose está `administered` THEN a célula SHALL mostrar o horário de `administeredAt` (carimbo).
3. WHEN a dose está `pending` e não é a próxima THEN a célula SHALL aparecer em branco (clicável).
4. WHEN existe dose `pending` THEN o sistema SHALL destacar exatamente uma como próxima (a mais próxima de agora: primeiro overdue mais antigo, senão a próxima futura).
5. WHEN o cuidador clica uma célula com dose THEN o sistema SHALL abrir modal com data/hora editável, observação opcional e confirmar.
6. WHEN confirma administração THEN o sistema SHALL persistir `status=administered`, `administeredAt` e nota opcional; a grade atualiza o carimbo.
7. IF a dose prevista é futura e `confirmEarly` não foi marcado THEN o sistema SHALL exigir confirmação explícita no modal (flag `confirmEarly`).

## Fora de escopo nesta fatia

- Pular dose / reverter (atalhos podem vir depois).
- Dashboard global de todos os pacientes.
