# SPEC: Calendário de doses no paciente

## Objetivo

Ao abrir um paciente, o cuidador vê um **calendário**:
- **Abas no topo:** uma por medicamento, cada uma com **cor de fundo** e o nome.
- **Linhas:** Ontem, Hoje e próximos dias.
- **Colunas:** horários em que há medicação.
- **Célula:** um ou mais **quadradinhos** na cor do medicamento (N remédios no mesmo horário → N quadrados).
  - Pendente → só contorno; administrada → preenchido; próxima → brilho.
- **Clique no quadrado:**
  - Pendente → modal para carimbo (data/hora), observação e salvar.
  - Já administrada → modal somente leitura com dados + **Editar**.

## Acceptance (EARS)

1. WHEN o cuidador abre o paciente com ≥1 tratamento ativo THEN o sistema SHALL exibir abas coloridas e a grade dias × horários (janela ontem → +6 dias).
2. WHEN há N doses no mesmo dia/horário THEN a célula SHALL mostrar N quadradinhos, cada um na cor do respectivo medicamento.
3. WHEN a dose está `pending` THEN o quadrado SHALL ter apenas contorno na cor do medicamento.
4. WHEN a dose está `administered` THEN o quadrado SHALL estar preenchido com a cor.
5. WHEN existe dose `pending` THEN o sistema SHALL destacar exatamente uma como próxima.
6. WHEN o cuidador clica um quadrado pendente THEN o modal SHALL pedir data/hora, observação opcional e confirmação.
7. WHEN o cuidador clica um quadrado administrado THEN o modal SHALL mostrar horário efetivo e observação, com opção Editar.
8. IF a dose prevista é futura e `confirmEarly` não foi marcado THEN o sistema SHALL exigir confirmação explícita.

## Fora de escopo nesta fatia

- Pular dose / reverter.
- Dashboard global de todos os pacientes.
