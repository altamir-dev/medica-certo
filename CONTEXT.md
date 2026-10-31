# Medica Certo

Contexto de domínio de um webapp para cuidadores administrarem medicamentos a um ou mais pacientes, substituindo tabelas em papel e despertadores manuais.

## Linguagem

**Cuidador**:
Pessoa autenticada responsável por cadastrar pacientes, configurar tratamentos e registrar administrações.
_Evitar_: usuário, responsável, enfermeiro (salvo se o papel for explicitamente clínico)

**Paciente**:
Pessoa que recebe os medicamentos, identificada por nome e data de nascimento.
_Evitar_: pessoa, cliente

**Medicamento**:
Item do catálogo com nome, princípio ativo, indicação, foto opcional, posologia de referência e intervalo usual.
_Evitar_: remédio, fármaco

**Princípio ativo**:
Substância principal contida no medicamento.
_Evitar_: elemento, composição (como sinônimo único)

**Posologia**:
Orientação de referência de quanto e como o medicamento costuma ser usado (texto descritivo no catálogo).
_Evitar_: dose (quando se refere à orientação genérica do catálogo)

**Quantidade da dose**:
Quanto administrar em cada ocorrência (ex.: 1 comprimido, 1 g, 20 gotas), definida no tratamento.
_Evitar_: posologia (quando se refere à ocorrência agendada)

**Via de administração**:
Caminho pelo qual o medicamento é dado (ex.: VO oral, EV endovenoso).
_Evitar_: forma, método

**Esquema de horários**:
Regra que define quando as doses previstas ocorrem no tratamento. Tem dois modos: **intervalo regular** (a cada N horas a partir da primeira dose) ou **horários customizados** (lista de horas do dia, ex.: 12:00, 18:00, 19:00, 20:00, repetida em cada dia do período).
_Evitar_: frequência (como sinônimo vago), intervalo (quando se refere ao conceito amplo que inclui o modo customizado)

**Intervalo regular**:
Modo do esquema em que as doses se espaçam a cada N horas a partir da primeira (ex.: 8/8h, 12/12h, 24/24h).
_Evitar_: horário fixo de relógio

**Tratamento**:
Vínculo entre um paciente e um medicamento, com data de início, eventual data de fim (ou uso contínuo), esquema de horários, quantidade da dose, via e grade de doses gerada.
_Evitar_: configuração, prescrição (salvo se houver vínculo formal com receita médica)

**Anotação**:
Texto livre ligado a uma dose ou ao tratamento (ex.: sobra de frasco, “fim”, mudança de esquema).
_Evitar_: comentário, nota genérica

**Grade de doses**:
Sequência de doses previstas do tratamento, do dia inicial até o último dia (ou em aberto no uso contínuo).
_Evitar_: tabela, calendário, agenda

**Dose prevista**:
Ocorrência agendada de administração (paciente, medicamento, data/hora, quantidade quando aplicável).
_Evitar_: alarme, despertador, slot

**Dose administrada**:
Registro de que uma dose prevista foi dada, com horário efetivo opcional.
_Evitar_: check, marcação, X

**Dashboard**:
Tela principal do cuidador com data/hora atual e as próximas doses previstas (para quem e qual dose).
_Evitar_: home, painel

**Janela de sono**:
Intervalo diário em que o paciente costuma dormir; usada na sugestão de horário da 1ª dose (modo intervalo regular). Padrão 22:00–07:00.
_Evitar_: quiet hours, horário silencioso (para alarmes de medicamento)

**Horários customizados**:
Modo do esquema em que uma lista de horas do dia se repete em cada dia do período do tratamento.
_Evitar_: horário fixo (como sinônimo vago do conceito inteiro)

## Relacionamentos

- Um **Cuidador** gerencia um ou mais **Pacientes**.
- Um **Medicamento** pode participar de vários **Tratamentos**.
- Um **Tratamento** pertence a um **Paciente**, referencia um **Medicamento**, define um **Esquema de horários** e possui uma **Grade de doses**.
- Cada **Dose prevista** pode ter zero ou uma **Dose administrada**.
- **Anotação** pode ligar-se a uma dose ou a um tratamento.
