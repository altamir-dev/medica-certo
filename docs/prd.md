# PRD — Medica Certo

## Visão geral

Webapp para um cuidador administrar medicamentos a um ou mais pacientes, substituindo tabelas em papel e despertadores manuais do celular. O cuidador autentica-se, vê no dashboard as próximas doses (para quem e qual quantidade), recebe alarmes, marca administrações e mantém catálogo de medicamentos e tratamentos com grade de doses.

Origem: `ideia.md` e folha de papel fotografada (`IMG_3313.HEIC`). Glossário canônico em `CONTEXT.md`.

## Personas / papéis

| Papel | Descrição |
|---|---|
| **Cuidador** | Único usuário autenticado no MVP. Cadastra pacientes, medicamentos e tratamentos; recebe alarmes; registra doses. |
| **Paciente** | Pessoa medicada (não faz login no MVP). Identificada por nome e data de nascimento. |

Compartilhamento entre vários cuidadores fica **fora do MVP**.

## Problema

Hoje o cuidador:

1. Mantém folhas com paciente, período, medicamentos, intervalo/dose e colunas por dia.
2. Marca `X` (às vezes com hora) ao administrar.
3. Cria despertadores no celular e, ao tocar, consulta a folha.

Isso é frágil (perda da folha, esquema ilegível, esquecimento de alarme, mudança de esquema no meio do curso).

## Objetivos do produto

1. Centralizar pacientes, medicamentos e tratamentos em um webapp com login.
2. Mostrar no dashboard data/hora atual e próximas doses previstas.
3. Gerar grade de doses a partir de um esquema de horários (intervalo regular ou horários customizados), sugerindo início que evite a janela de sono.
4. Permitir registrar dose administrada, atrasada ou pulada, com hora efetiva e anotações.
5. Disparar alarmes no app para doses previstas.
6. Suportar tratamentos com data fim e uso contínuo (sem data fim).

## Decisões de produto (fechadas no refinamento)

| Tema | Decisão |
|---|---|
| Esquema de horários | Dois modos por tratamento: **intervalo regular** (a cada N h a partir da 1ª dose) ou **horários customizados** (lista de horas do dia, repetida em cada dia). |
| Escopo do dia a dia | Tabelas + registro de doses + **alarmes no app**. |
| Multi-cuidador | Um cuidador no MVP; compartilhamento depois. |
| Janela de sono | Padrão **22:00–07:00**, editável por paciente. |
| Dose atrasada | Estados: **pendente**, **administrada** (incluindo atrasada, com hora real) e **pulada**. |
| Uso contínuo | Sim — sem data fim; grade em janela rolante; cuidador encerra quando quiser. |
| Mudança de esquema | Encerrar o tratamento atual e abrir outro com o novo esquema (histórico limpo). |

## Escopo do MVP

### Incluído

- Autenticação do cuidador (login/logout).
- CRUD de pacientes (nome, data de nascimento, janela de sono).
- Catálogo de medicamentos (nome, princípio ativo, indicação, foto opcional, posologia de referência, intervalo usual sugerido).
- Busca de medicamento; se não existir, fluxo para cadastro.
- Criação/edição/encerramento de tratamento (paciente, medicamento, início, fim opcional, quantidade da dose, via, esquema de horários).
- Sugestão de horário da 1ª dose (modo intervalo regular) respeitando janela de sono.
- Pré-visualização das próximas doses ao escolher a 1ª hora / lista de horários.
- Grade de doses do tratamento (visão por período).
- Dashboard com próximas doses de todos os pacientes do cuidador.
- Registro de administração (hora efetiva, anotação opcional).
- Marcar dose como pulada; manter pendente.
- Alarmes/notificações para doses previstas.
- Tratamento contínuo (sem data fim) com geração à frente em janela rolante.

### Fora do escopo (MVP)

- Compartilhamento / múltiplos cuidadores no mesmo paciente.
- Prescrição médica formal, receita, integração com farmácia ou prontuário.
- Controle de estoque / frascos (anotação livre basta).
- App nativo dedicado (webapp; PWA/notificações conforme viável no browser).
- Relatórios analíticos avançados e exportação para papel (pode ser pós-MVP).
- Cadastro do paciente como usuário do sistema.

## Requisitos

### R1 — Autenticação

**User story:** Como cuidador, quero fazer login, para acessar somente os meus pacientes e tratamentos.

**Critérios de aceite:**

1. WHEN o cuidador informa credenciais válidas THEN o sistema SHALL autenticá-lo e exibir o dashboard.
2. WHEN as credenciais são inválidas THEN o sistema SHALL recusar o acesso e exibir mensagem de erro.
3. WHEN o cuidador não está autenticado e acessa rota protegida THEN o sistema SHALL redirecioná-lo para o login.
4. WHEN o cuidador encerra a sessão THEN o sistema SHALL invalidar a sessão e exigir novo login.

**Casos de borda:**

- Sessão expirada: redirecionar ao login preservando intenção de retorno quando possível.

---

### R2 — Cadastro de paciente

**User story:** Como cuidador, quero cadastrar pacientes com nome e data de nascimento, para organizar os tratamentos por pessoa.

**Critérios de aceite:**

1. WHEN o cuidador informa nome e data de nascimento válidos THEN o sistema SHALL criar o paciente vinculado ao cuidador.
2. WHEN o nome está vazio THEN o sistema SHALL impedir o salvamento e indicar o campo obrigatório.
3. WHEN o cuidador edita um paciente THEN o sistema SHALL persistir as alterações.
4. WHEN o cuidador define ou altera a janela de sono THEN o sistema SHALL usar essa janela nas sugestões de horário daquele paciente.
5. IF o cuidador não definiu janela de sono THEN o sistema SHALL usar o padrão 22:00–07:00.

**Casos de borda:**

- Lista vazia de pacientes: dashboard indica ausência e oferece cadastro.
- Data de nascimento futura: rejeitar.

---

### R3 — Catálogo e busca de medicamento

**User story:** Como cuidador, quero cadastrar e buscar medicamentos, para reutilizá-los em vários tratamentos.

**Critérios de aceite:**

1. WHEN o cuidador cadastra um medicamento com nome THEN o sistema SHALL salvá-lo no catálogo do cuidador.
2. WHEN o cuidador informa princípio ativo, indicação, posologia de referência, intervalo usual e/ou foto THEN o sistema SHALL armazenar esses campos (foto opcional).
3. WHEN o cuidador busca por nome ou princípio ativo THEN o sistema SHALL listar medicamentos correspondentes.
4. WHEN a busca não encontra resultados THEN o sistema SHALL oferecer caminho direto para cadastro.
5. WHEN o cuidador está configurando um tratamento e o medicamento não existe THEN o sistema SHALL permitir cadastrá-lo e retornar ao fluxo do tratamento.

**Casos de borda:**

- Nome duplicado no catálogo do mesmo cuidador: avisar e permitir confirmação ou reutilizar o existente.

---

### R4 — Tratamento e esquema de horários

**User story:** Como cuidador, quero vincular um medicamento a um paciente com data inicial, quantidade, via e esquema de horários, para gerar a grade de doses.

**Critérios de aceite:**

1. WHEN o cuidador cria um tratamento THEN o sistema SHALL exigir paciente, medicamento, data/hora de início (ou data de início + esquema), quantidade da dose e modo de esquema.
2. WHEN o modo é **intervalo regular** THEN o sistema SHALL exigir o intervalo em horas (N) e gerar doses a cada N horas a partir da primeira.
3. WHEN o modo é **horários customizados** THEN o sistema SHALL exigir uma lista de pelo menos um horário do dia e gerar, para cada dia do período, uma dose prevista em cada horário da lista.
4. WHEN o cuidador informa data de fim THEN o sistema SHALL gerar a grade do início até o fim (inclusive, conforme regra de corte da última dose).
5. WHEN o cuidador não informa data de fim THEN o sistema SHALL tratar o tratamento como contínuo e gerar doses em janela rolante à frente (mínimo 7 dias; extensão automática conforme o tempo avança).
6. WHEN o cuidador encerra um tratamento THEN o sistema SHALL deixar de gerar novas doses previstas e manter o histórico.
7. WHEN o esquema precisa mudar no meio do curso THEN o cuidador SHALL encerrar o tratamento atual e criar um novo com o novo esquema (o sistema MAY facilitar o atalho “encerrar e recriar”).
8. IF o medicamento escolhido não estiver cadastrado THEN o sistema SHALL direcionar ao cadastro antes de concluir o tratamento.

**Casos de borda:**

- Lista de horários customizados desordenada: ordenar automaticamente.
- Horário duplicado na lista: rejeitar ou deduplicar com aviso.
- Intervalo N ≤ 0: rejeitar.
- Data fim anterior à data início: rejeitar.

---

### R5 — Sugestão inteligente de horários (intervalo regular)

**User story:** Como cuidador, quero uma sugestão de horário de início que evite acordar o paciente na madrugada, para montar a grade com menos atrito.

**Critérios de aceite:**

1. WHEN o modo é intervalo regular e o cuidador solicita sugestão THEN o sistema SHALL propor um horário de primeira dose tal que o menor número possível de doses previstas caia dentro da janela de sono do paciente.
2. WHEN existir empate entre candidatos THEN o sistema SHALL preferir horários diurnos (fora da janela de sono).
3. WHEN o cuidador escolhe a primeira hora (sugerida ou manual) THEN o sistema SHALL exibir a previsão das próximas doses (pré-visualização).
4. WHEN a janela de sono do paciente é alterada THEN novas sugestões SHALL respeitar a nova janela (grades já geradas não recalculam automaticamente).

**Casos de borda:**

- Intervalo que inevitavelmente cai na janela de sono (ex.: 6/6h): sugerir o melhor compromisso e avisar que haverá doses na janela de sono.
- Modo horários customizados: sugestão automática de “melhor início” não se aplica; o cuidador informa a lista; o sistema ainda mostra a pré-visualização da grade.

---

### R6 — Grade de doses e dashboard

**User story:** Como cuidador, quero ver as próximas doses e a grade do tratamento, para saber o que dar, para quem e quando.

**Critérios de aceite:**

1. WHEN o cuidador abre o dashboard THEN o sistema SHALL exibir data e hora atuais e a lista de próximas doses previstas (paciente, medicamento, quantidade, via, horário).
2. WHEN existem doses pendentes no passado recente THEN o sistema SHALL destacá-las como atrasadas/pendentes além das próximas futuras.
3. WHEN o cuidador abre um tratamento THEN o sistema SHALL exibir a grade de doses do período (equivalente à folha: dias × ocorrências).
4. WHEN não há doses futuras THEN o sistema SHALL exibir estado vazio com orientação (cadastrar tratamento ou verificar filtros).

**Casos de borda:**

- Vários pacientes: ordenar próximas doses por data/hora crescente.
- Tratamento contínuo: grade mostra a janela gerada (não o infinito).

---

### R7 — Registro de administração

**User story:** Como cuidador, quero marcar que dei o medicamento (com hora real se quiser), ou que pulei a dose, para manter o histórico no lugar do “X” no papel.

**Critérios de aceite:**

1. WHEN o cuidador marca uma dose prevista como administrada THEN o sistema SHALL criar a dose administrada com horário efetivo (padrão: agora; editável).
2. WHEN a administração ocorre após o horário previsto THEN o sistema SHALL registrá-la como administrada atrasada (sem impedir o registro).
3. WHEN o cuidador marca a dose como pulada THEN o sistema SHALL registrar o status pulada e não exigir horário efetivo.
4. WHEN a dose permanece sem ação após o horário previsto THEN o sistema SHALL mantê-la pendente até o cuidador administrar ou pular.
5. WHEN o cuidador adiciona uma anotação THEN o sistema SHALL vinculá-la à dose ou ao tratamento, conforme o contexto da UI.
6. WHEN o cuidador tenta marcar duas vezes a mesma dose prevista THEN o sistema SHALL impedir duplicidade de dose administrada.

**Casos de borda:**

- Desfazer marcação (administrada → pendente): permitido no MVP apenas se não houver regra clínica restritiva; se desfazer, remover o registro de administração.
- Dose futura: permitir administrar adiantado com confirmação explícita.

---

### R8 — Alarmes

**User story:** Como cuidador, quero receber alarmes das doses previstas no app, para não depender dos despertadores manuais do celular.

**Critérios de aceite:**

1. WHEN uma dose prevista estiver próxima do horário THEN o sistema SHALL disparar alarme/notificação para o cuidador autenticado no dispositivo.
2. WHEN o cuidador interage com o alarme THEN o sistema SHALL oferecer caminho rápido para marcar administrada ou pulada.
3. WHEN a dose já foi administrada ou pulada THEN o sistema SHALL não disparar (ou cancelar) o alarme correspondente.
4. WHEN o cuidador desativa alarmes globalmente ou por tratamento THEN o sistema SHALL respeitar a preferência.

**Casos de borda:**

- Permissão de notificação negada no browser: exibir orientação para habilitar; dashboard continua funcional.
- Várias doses no mesmo minuto: agregar ou encadear de forma compreensível.

**Nota de implementação (não funcional no detalhe técnico):** priorizar PWA / Web Push ou mecanismo equivalente disponível no browser alvo; detalhar no design.

---

## Requisitos não funcionais

- **Usabilidade:** fluxo principal (ver próxima dose → marcar administrada) em poucos toques; adequado a uso em celular (viewport mobile).
- **Desempenho:** dashboard e próximas doses devem carregar em tempo interativo sob volume típico doméstico (dezenas de pacientes, centenas de doses na janela).
- **Segurança:** apenas o cuidador autenticado acessa seus pacientes, tratamentos e histórico; credenciais e sessão protegidos.
- **Auditoria leve:** manter horário previsto, horário efetivo e status (pendente / administrada / pulada) para consulta posterior.
- **Idioma:** interface em pt-BR.
- **Disponibilidade offline:** fora do MVP (desejável depois).

## Regras de negócio resumidas

1. Um tratamento = um esquema de horários; mudança de esquema ⇒ encerrar + novo tratamento.
2. Intervalo regular conta a partir da primeira dose; horários customizados repetem a lista em cada dia do período.
3. Uso contínuo não exige data fim; geração em janela rolante.
4. Dose prevista tem no máximo uma dose administrada.
5. Janela de sono padrão 22:00–07:00, editável por paciente.
6. Catálogo e pacientes pertencem ao cuidador (isolamento no MVP).

## Telas (MVP)

1. **Login**
2. **Dashboard** — data/hora atual, próximas doses, destaque de pendentes atrasadas
3. **Pacientes** — lista, criar/editar (nome, nascimento, janela de sono)
4. **Medicamentos** — busca, detalhe, criar/editar (inclui foto opcional)
5. **Tratamento** — criar/editar: medicamento, período, quantidade, via, modo de esquema, sugestão/pré-visualização, encerrar
6. **Grade do tratamento** — visão temporal das doses e status
7. **Registro rápido de dose** — a partir do dashboard ou do alarme

## Métricas de sucesso (orientação)

- Cuidador consegue configurar um tratamento e ver a grade no mesmo dia de uso.
- Zero dependência de despertadores manuais para os tratamentos ativos (alarmes do app em uso).
- Registro de administração no horário (ou com atraso explícito) na maioria das doses previstas.

## Decisões em aberto (pós-PRD / design)

- Antecipação exata do alarme (ex.: 0, 5 ou 10 minutos) e comportamento de soneca.
- Tamanho padrão da janela rolante do contínuo (sugerido: 7 dias, extensível).
- Provedor de autenticação (e-mail/senha vs magic link).
- Obrigatoriedade de via de administração e de quantidade da dose (recomendado: obrigatórias no tratamento).
- Política de retenção de histórico e exportação.

## Próximos passos sugeridos

1. Validar este PRD (rodada de revisão contra o objetivo da feature).
2. Documento de design (arquitetura, modelo de dados, APIs, UI) alinhado a `CONTEXT.md`.
3. Implementação do MVP por fatias: auth → pacientes/medicamentos → tratamento/grade → dashboard/registro → alarmes.
