# Planejamento — Cadastro de medicamento por foto

| Campo | Valor |
|---|---|
| Status | Proposta para decisão. Sem código de produção neste documento. |
| Data | 2026-10-31 |
| Autor do pedido | Altamir |
| Base lida | `main` em `2f09af5` (migração `007_treatment_end_reason.sql` já aplicada no repositório) |
| Próxima migração | `008_…`. A 007 só acrescenta `treatments.end_reason`. |
| Deploy | Merge na `main` dispara o workflow de produção. Este plano não pede merge. |

O cuidador fotografa a caixa ou a receita. O servidor lê a imagem, propõe nome, composição e — se for receita — a posologia daquele tratamento, e só grava medicamento e tratamento depois que a pessoa confirma os campos na tela.

A posologia sugerida não substitui o médico nem a bula. O app é o caderno do cuidador, no sentido já definido em `CONTEXT.md` e no PRD. Não é prescritor.

---

## 1. Recomendação

**Visão multimodal numa chamada, saída JSON com schema, e ancoragem determinística em snapshot local da Anvisa/CMED.** O modelo lê a foto. O banco oficial confirma nome, princípio ativo, concentração e apresentação. O que o modelo “sabe de memória” sobre indicação ou posologia usual não entra no cadastro.

**Cliente único, compatível com a API da OpenAI** (`/v1/chat/completions` + `response_format` JSON schema). A URL e a chave vêm de ambiente, então o mesmo código fala com a OpenRouter ou com o 9router.

**Modelo pinado para produção: `openai/gpt-4.1-mini` via OpenRouter**, com `provider.data_collection: "deny"` e fallback entre provedores desligado. Custo estimado da ordem de **US$ 0,002 por foto** (menos de US$ 0,10 em 30 fotos no mês). Latência alvo de **5 a 15 s** depois de a imagem já estar reduzida; timeout **45 s**.

**Jev (`typesafe/jev-router`) fica de fora deste fluxo**, mesmo que o 9router o exponha como alias. Jev escolhe outro modelo a cada pedido: o custo não tem teto, o subprocessador que vê a receita muda, e o suporte a JSON schema deixa de ser garantido. Se “Jev” no 9router for só um apelido para um modelo de visão fixo, esse apelido pode ser o `AI_MODEL` — desde que não haja fallback para outro provedor.

**Gemini 2.5 Flash-Lite** é a alternativa barata (cerca de **US$ 0,0005 por foto**, 2 a 8 s). Desde 18/10/2026 há relato de que rotas Gemini na OpenRouter deixaram de ser zero-retention. Receita é dado de saúde. Flash-Lite só entra se o Altamir aceitar envio a Google com essa política, conferida de novo no dia da implementação.

OCR clássico (Tesseract ou API de OCR) e depois um LLM de texto fica como alternativa rejeitada para a v1: foto de caixa com reflexo e receita manuscrita são exatamente onde o OCR quebra, e o segundo modelo passa a alucinar em cima de texto ruim.

A fatia de bula (posologia usual citada) fica **depois** do fluxo útil. Na v1 a posologia do tratamento sai da receita ou fica em branco para o cuidador preencher. A posologia usual do catálogo só é preenchida quando houver trecho de bula citado. Classe terapêutica da Anvisa não é gravada no campo `indication`.

`AI_ENABLED` nasce desligado. Produção só liga a chave depois da fatia de privacidade (F7).

---

## 2. O que o código faz hoje

Glossário usado daqui em diante: medicamento, princípio ativo, posologia, quantidade da dose, via, esquema de horários, tratamento (`CONTEXT.md`).

### 2.1 Medicamento

`server/migrations/003_medications.sql` e `server/medications.mjs`.

| Coluna | Papel hoje | Limite na API |
|---|---|---|
| `name` | Obrigatório, único por cuidador em `lower(name)` | 120 |
| `active_ingredient` | Princípio ativo, texto livre | 200 |
| `indication` | Indicação, texto livre | 500 |
| `reference_posology` | Posologia de referência do catálogo | 2000 |
| `usual_interval_hours` | Inteiro 1–168, opcional | — |
| `photo_path` | Caminho relativo ou NULL | — |

Não existe coluna de concentração, apresentação, registro Anvisa, origem do dado nem auditoria de IA.

A foto do catálogo:

- `POST /api/medications/:id/photo`, campo `photo`, JPEG/PNG/WebP, máx. **2 MB**, checagem de magic bytes.
- Arquivo em `{dataDir}/med-photos/{caregiver_id}/{uuid}.ext`. `dataDir` é `data/` na raiz do repo (`server/config.mjs`).
- `GET` autenticado, `Cache-Control: private`, sem listagem pública.
- O medicamento é criado **antes** da foto. Se o upload falha, o registro já existe e a UI volta para a edição com aviso (`MedicationFormPage`).
- O Compose publica só o volume `data/med-photos`. Qualquer outro diretório sob `data/` some quando o container é recriado.
- Limite de 2 MB é curto para foto crua de celular (muitas passam de 3 MB). O formulário atual não reduz a imagem no browser. iPhone em HEIC não está na lista de MIME.

Busca: `GET /api/medications?q=` por nome ou princípio ativo (`ILIKE`). Nome duplicado responde `409 DUPLICATE_NAME` com `fields.existingId`.

### 2.2 Tratamento e doses

`004_treatments_doses.sql`, `007_treatment_end_reason.sql`, `server/treatments.mjs`, `server/routes/treatments.mjs`.

O tratamento exige paciente, medicamento, `starts_at`, `dose_quantity` (até 120), `route`, e um esquema:

- `regular_interval` + `interval_hours` > 0, ou
- `custom_times` + `times_of_day` com ao menos um horário.

`ends_on` NULL significa uso contínuo (janela rolante). Encerrar grava `status = ended` e, desde a 007, `end_reason` opcional (até 500). Doses previstas nascem em `scheduled_doses` na criação. `POST /api/treatments/preview` e `POST /api/treatments/suggest-first-dose` não gravam.

Vias oferecidas na UI (`ROUTE_OPTIONS` em `web/src/api/treatments.ts`): `VO`, `SL`, `IM`, `EV`, `SC`, `tópica`, `inalatória`, `retal`, `ocular`, `nasal`, `outra`. O parser do servidor só rejeita via vazia ou via fora dessa lista **com mais de 40 caracteres**. Uma via curta desconhecida passaria. O fluxo novo deve emitir só valores da lista.

Fuso do formulário: `America/Sao_Paulo`.

Atalho atual ao voltar do cadastro de medicamento: `?medicationId=` no formulário de tratamento. Se o catálogo tem `usualIntervalHours`, preenche o intervalo. Se tem `referencePosology`, **copia o texto inteiro para a quantidade da dose**. Isso mistura posologia de catálogo com quantidade da ocorrência. O fluxo por foto não deve repetir esse atalho: quantidade da dose é “1 comprimido” ou “20 gotas”, não o parágrafo da bula.

### 2.3 Onde a pessoa entra hoje

| Rota | Tela |
|---|---|
| `/medicamentos`, `/medicamentos/novo`, `/medicamentos/:id` | Catálogo e formulário manual |
| `/pacientes/:id/tratamentos/novo` | Escolhe medicamento já cadastrado e define o esquema |
| `/tratamentos/:id` | Detalhe, encerrar |
| `/` | Dashboard de doses |

Não há fila, worker nem chamada de LLM. Rate limit existente é o de login/registro: janela em memória, 10 por minuto, no processo único (`createRateLimiter` em `server/auth.mjs`). A réplica de produção é 1 (`docs/adr/001-stack.md`), então um limitador em memória segura o curto prazo, mas zera a cada deploy. Teto de custo precisa de contagem no Postgres.

O scheduler de alarmes já roda dentro do processo (`server/scheduler.mjs`). Um expurgo de rascunhos cabe no mesmo lugar, sem fila nova.

O PRD lista “prescrição médica formal, receita, integração com farmácia ou prontuário” como **fora do MVP**. Esta feature amplia o produto. A fatia que implementar deve atualizar o PRD numa frase: ler a receita para preencher o caderno do cuidador continua sem ser prescrição do sistema.

Erros já padronizados: `{ error: { code, message, fields? } }`. Códigos úteis a reutilizar: `UNAUTHORIZED`, `VALIDATION`, `NOT_FOUND`, `DUPLICATE_NAME`, `CONFLICT`, `RATE_LIMITED`.

---

## 3. Princípios

1. **Nada de medicamento, tratamento ou dose prevista sem confirmação humana.** A análise grava só um rascunho. O `INSERT` em `medications` / `treatments` acontece no POST de confirmação, com o payload editado pela pessoa, validado pelos parsers que já existem.
2. **Dois fatos diferentes não compartilham o mesmo campo.** O que está impresso na receita é a posologia daquele tratamento. O que está na bula é posologia de referência do catálogo. O modelo não completa um com o outro.
3. **Campo oficial só sobe de confiança com fonte oficial.** Nome parecido no snapshot Anvisa/CMED preenche princípio ativo, concentração, apresentação e registro, com a origem visível. Sem match, esses campos oficiais ficam vazios. O nome lido na foto continua editável.
4. **A imagem que sai do servidor é a menor possível e sem EXIF.** Não vão na requisição e-mail do cuidador, nome do paciente, data de nascimento nem o restante do catálogo. A foto da receita pode conter esses dados nela mesma; o aviso diz isso com clareza.
5. **Falha devolve a pessoa ao formulário manual**, com o que tiver sido lido ainda editável. Não há gravação parcial “para não perder”.
6. **Aviso fixo na revisão:** a posologia sugerida não substitui a orientação do médico ou da bula. Conferir antes de salvar.

---

## 4. UX

Dois pontos de entrada. O formulário manual permanece.

| Entrada | Rota nova | O que a confirmação grava |
|---|---|---|
| Lista de medicamentos, “Cadastrar com foto” | `/medicamentos/por-foto` | Só o medicamento |
| Paciente, “Fotografar caixa ou receita” | `/pacientes/:id/tratamentos/por-foto` | Medicamento (ou reutiliza um já existente) e o tratamento |

A segunda rota é a que aproveita a receita. Sem `patientId` o servidor recusa criar tratamento.

### 4.1 Passos

```text
Aviso (na primeira vez, e de novo em toda receita)
  → Captura
  → Envio
  → Processando
  → Revisão editável
  → Confirmar  |  Descartar  |  Abrir formulário manual
```

**Aviso.** Texto curto, antes do primeiro envio: a foto é lida por um serviço de IA fora do servidor (nome do provedor, vindo da config); receita pode mostrar nome, documento e CRM e essa imagem segue junto; nada é cadastrado antes de confirmar; o app não substitui o médico. Checkbox “Entendi”. Gravar `caregivers.ai_image_consent_at`. Trocar de provedor ou de modelo pede o aceite de novo. Em toda receita, repetir o aviso em uma linha acima do botão, sem esconder atrás do aceite antigo.

**Captura.** `<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment">` mais a opção de galeria (sem `capture` no segundo botão). Preview local. O browser reduz para JPEG, lado maior 1600 px, qualidade ~0.8, o que também descarta EXIF no canvas. Botões: Analisar, Cancelar. Cancelar antes do upload não cria rascunho.

**Processando.** Tela com a preview e três estados visíveis, mesmo que o servidor só exponha um status: “Enviando”, “Lendo a imagem”, “Conferindo o nome na base da Anvisa”. Poll de `GET /api/medication-drafts/:id` a cada 1 s, até 50 s. Se a pessoa sair da rota, o rascunho continua no servidor até expirar; ao voltar, a revisão abre se o status for `ready`. Não há segundo envio enquanto existir um rascunho `processing` daquele cuidador.

**Revisão.** Foto no topo. Em seguida, o tipo detectado: Embalagem, Receita ou Não reconhecido.

Por campo, nesta ordem: valor editável, selo de confiança, origem.

| Selo | Regra |
|---|---|
| Alta | Confiança do modelo ≥ 0,85 **e** o servidor não teve motivo para rebaixar |
| Média | 0,5–0,85, ou discordância entre o modelo e um regex da posologia |
| Baixa | < 0,5, imagem marcada ilegível, ou campo oficial sem match |
| Ausente | Vazio. A pessoa preenche ou segue sem aquele opcional |

Origens exibidas: “lido na foto”, “Anvisa/CMED”, “bula (trecho citado)” — só na fatia de bula —, “você”.

Campos do medicamento: nome, princípio ativo, concentração, apresentação, registro (somente leitura quando veio do snapshot, com botão “limpar”), indicação, posologia de referência. Na v1, indicação e posologia de referência nascem vazias, com a dica “não preenchido pela IA”. Classe terapêutica, se houver match, aparece como texto de apoio (“classe na Anvisa: …”) e **não** entra em `indication`.

Se o snapshot devolver dois ou três candidatos (mesma substância, laboratórios ou concentrações diferentes), um seletor lista produto, laboratório, apresentação e registro. Escolher um candidato preenche os campos oficiais. Não escolher deixa os oficiais vazios.

Campos do tratamento (só na rota do paciente, e só se o tipo for receita ou se a pessoa marcar “criar tratamento mesmo assim” numa embalagem):

- quantidade da dose;
- via, `<select>` com `ROUTE_OPTIONS` (vazio se o mapeamento não for seguro);
- esquema: intervalo regular **ou** horários do dia, os mesmos controles do `TreatmentFormPage`;
- duração: data fim, “por N dias” já convertido em data, ou uso contínuo;
- início, padrão “agora” em `America/Sao_Paulo`;
- texto cru lido na receita, somente leitura, para a pessoa comparar;
- pré-visualização das próximas doses, reusando `POST /api/treatments/preview`, antes do botão de confirmar. Se o intervalo cair na janela de sono, o aviso que já existe em `suggest-first-dose` aparece aqui também — a pessoa escolhe o horário, o servidor não troca sozinho o que estava escrito na receita.

Receita com vários itens: uma lista. Cada item é um bloco com os campos acima. A pessoa desmarca o que não quer cadastrar. A v1 da fatia de receita pode entregar **um** item (o de maior confiança, com aviso se houver outros) e a fatia seguinte entrega a lista. Ver perguntas em aberto.

**Confirmar** fica desabilitado sem nome do medicamento. Com tratamento ligado, também exige quantidade, via da lista e esquema válido — as mesmas regras de `parseTreatmentBody`. O botão diz “Cadastrar” ou “Cadastrar medicamento e tratamento”.

**Descartar** apaga o rascunho e o arquivo e volta à lista. **Formulário manual** abre `/medicamentos/novo` (ou o de tratamento) com os campos já digitados na revisão passados na navegação. Ainda assim nada foi gravado; salvar continua sendo o submit daquele formulário.

### 4.2 Falhas

| Situação | O que a pessoa vê | O que fica gravado |
|---|---|---|
| Arquivo vazio, MIME errado, magic bytes falsos, acima de 8 MB | Erro no passo de captura. A IA não é chamada | Nada |
| HEIC | “Use JPEG, PNG ou WebP.” Sem conversor na v1 | Nada |
| Provedor fora, timeout, HTTP 5xx | “Não consegui ler a foto.” Tentar de novo ou preencher à mão | Rascunho `failed`, imagem até expirar (24 h) |
| JSON ilegível depois de uma nova tentativa | O mesmo, com os campos vazios se algo tiver sido salvo como `ready` parcial — na prática marca `failed` | Rascunho `failed` |
| Foto que não é caixa nem receita | Revisão com tipo “Não reconhecido” e campos vazios | Rascunho `ready`, nada no catálogo |
| Nome já existe | “Você já tem {nome}.” Ações: usar o existente (e seguir para o tratamento, se houver paciente) ou voltar e editar o nome | Sem segundo medicamento |
| Limite diário ou teto mensal | “Limite de leituras atingido. Dá para cadastrar à mão.” | Nada além do contador |
| `AI_ENABLED` desligado | O botão de foto não aparece. A rota de análise responde 404 | Nada |
| Sessão cai no meio | Login de novo; o rascunho continua do cuidador se ainda não expirou | Rascunho |

Confirmado uma segunda vez no mesmo rascunho devolve o medicamento (e o tratamento) já criados, sem duplicar.

---

## 5. Arquitetura

```text
browser
  reduz JPEG, tira EXIF no canvas
  POST /api/medication-drafts          (multipart, sessão)
        │
        ▼
Fastify (processo único)
  valida imagem → grava intake-photos/ → linha medication_drafts processing
  chamada OpenAI-compatível, JSON schema, timeout 45 s
  valida o JSON no servidor
  match no snapshot anvisa_presentations (pg_trgm)
  rebaixa confiança
  status = ready | failed
        │
        ▼
GET do rascunho (poll)
  revisão humana
        │
        ▼
POST .../confirm
  parseMedicationBody + parseTreatmentBody
  transação: medications, foto de catálogo se for embalagem,
             treatments + scheduled_doses se pedido,
             auditoria, rascunho confirmed
```

A chamada de visão roda no processo, como o scheduler. Não há fila. Com uma réplica isso basta para o volume de um cuidador. Se o processo morrer no meio, o expurgo marca `processing` com mais de 2 minutos como `failed`.

Traefik na frente: o POST de criação responde **202** assim que o arquivo está gravado e a tarefa começou, para não depender do timeout do proxy durante os 45 s. O poll é que espera. O POST de confirmação é rápido (só Postgres e cópia de arquivo).

### 5.1 Por que uma chamada multimodal, e não OCR + LLM

| Caminho | Leitura de caixa | Receita impressa | Receita manuscrita | Dado que sai do servidor | Onde entra alucinação |
|---|---|---|---|---|---|
| LLM com visão, um pedido | Boa em rótulo, desde que a foto esteja legível | Boa | Variável; confiança baixa e campo vazio quando ilegível | A imagem, uma vez | Na posologia e no nome, se não houver ancoragem |
| Tesseract local + LLM de texto | Fraca com perspectiva e reflexo | Razoável se o papel estiver reto | Fraca | Só o texto, se o LLM for externo | O LLM “conserta” OCR errado e inventa o remédio |
| OCR de nuvem (Vision, Document AI) + LLM | Boa | Boa em impresso | Variável | Imagem para o OCR **e** texto para o LLM: dois subprocessadores | A mesma, com custo e contrato a mais |

A v1 fica no primeiro caminho. O OCR local pode ser reavaliado se um conjunto de fotos reais (com consentimento) mostrar que a visão erra nomes que o OCR acerta. Até lá, não há dois provedores no mesmo pedido.

### 5.2 Classificar embalagem ou receita

Não é um modelo separado. O schema obrigatório traz `documentKind`: `package`, `prescription` ou `unknown`, mais `documentKindConfidence`. O prompt descreve os três casos (caixa/frasco/cartela, receita ou pedido médico, qualquer outra coisa).

Heurística só para rebaixar, nunca para inventar conteúdo: se o modelo disser `package` e o texto cru tiver “CRM”, “posologia” ou vários itens com horário, o tipo passa a `unknown` e a UI pede que a pessoa escolha. O inverso também: `prescription` sem nenhum item de dose fica `unknown`.

### 5.3 Schema de saída

`response_format` JSON schema, `strict` quando o provedor aceitar. Versão do prompt em constante (`prompt_version`), gravada no rascunho. O servidor descarta chaves fora do schema (nome de paciente, CPF, CRM, registro Anvisa inventado).

```json
{
  "documentKind": "package",
  "documentKindConfidence": 0.0,
  "unreadable": false,
  "items": [
    {
      "name": "Dipirona",
      "nameConfidence": 0.0,
      "manufacturer": null,
      "presentationText": null,
      "activeIngredients": [
        { "name": "dipirona", "concentration": "500 mg", "confidence": 0.0 }
      ],
      "schedule": {
        "doseQuantity": null,
        "routeText": null,
        "mode": "unknown",
        "intervalHours": null,
        "timesOfDay": [],
        "durationDays": null,
        "continuousUse": false,
        "rawText": null,
        "confidence": 0.0
      }
    }
  ]
}
```

Regras do prompt, em português, curtas:

- Ler só o que está visível. String vazia e confiança 0 quando não der para ler.
- Não inventar número de registro, EAN, indicação, nem posologia usual de bula.
- Não devolver nome de paciente, CPF, CRM, endereço ou CID.
- Vários medicamentos na mesma receita viram vários `items`.
- `routeText` é o que está escrito (“via oral”, “VO”, “tomar”), não um código forçado.
- `mode` é `regular_interval`, `custom_times` ou `unknown`.
- No máximo 8 itens.

O servidor, depois do JSON válido, ainda faz o seguinte antes de mostrar a revisão:

1. Corta textos nos limites atuais (nome 120, princípio ativo 200, indicação 500, posologia 2000, quantidade 120).
2. Mapeia `routeText` para `ROUTE_OPTIONS`. Sem mapa seguro, a via fica vazia e o texto cru permanece visível. Mapa inicial: oral/VO → `VO`; sublingual → `SL`; IM/intramuscular → `IM`; EV/IV/endovenoso/intravenoso → `EV`; SC/subcutâneo → `SC`; tópico → `tópica`; inalação → `inalatória`; retal, ocular/oftálmico, nasal nos homônimos. O resto não vira `outra` sozinho — `outra` esconde erro de leitura. A pessoa escolhe.
3. Compara com regex no `rawText`: `8/8h`, `de 8 em 8 horas`, horários `8h` / `08:00`, `por 7 dias`, `uso contínuo`. Se o regex e o modelo discordarem, o selo daquele campo cai para média e os dois textos aparecem.
4. `por N dias` vira `endsOn` = data local de `startsAt` mais `N - 1` dias (o dia inicial conta). Uso contínuo deixa `endsOn` vazio. Isso é proposta; a pré-visualização mostra o efeito antes de gravar. Ver pergunta em aberto.
5. Horários explícitos na receita ganham de “a cada N horas”. “8/8h” sem relógio vira intervalo regular; a sugestão de primeira dose respeitando a janela de sono é oferecida, não aplicada.
6. Roda o match Anvisa/CMED (seção 5.4) e só então marca origem e confiança dos campos oficiais.

`items` vazio ou `unreadable: true` produz revisão vazia com a foto, status `ready`. Não é erro técnico.

### 5.4 Ancoragem Anvisa / CMED — como não alucinar

Fontes, conferidas em 31/10/2026:

| Fonte | O que tem | O que não tem | Uso |
|---|---|---|---|
| CMED, planilha mensal de PMC em [gov.br/anvisa …/cmed/precos](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/cmed/precos) | Por apresentação: substância, produto, laboratório, registro (13 dígitos), EAN, apresentação (“500 MG COM CT … X 20”), tarja | Posologia, indicação clínica | Concentração, apresentação, registro, desambiguar laboratório |
| `TA_CONSULTA_MEDICAMENTOS.CSV` em `dados.anvisa.gov.br/dados/CONSULTAS/PRODUTOS/` (~114 MB em 13/10/2026) | Nome, princípio ativo, número de registro dos regularizados | Apresentação/concentração por embalagem, posologia | Rede de segurança se a CMED não listar o produto (preço liberado, alguns casos) |
| `DADOS_ABERTOS_MEDICAMENTOS.csv` | Registro (9 dígitos do produto), princípio ativo, classe terapêutica, situação ativo/inativo. Atualização mensal, com linhas repetidas | Posologia; apresentações de 13 dígitos | Classe terapêutica só como dica de UI. Situação do registro |
| API `recuperar-lista-cmed-completa` | O mesmo dado da CMED em JSON | Exige Bearer; payload enorme num pedido só | Fora do caminho quente. O import local usa a planilha |
| Bulário eletrônico | PDF da bula do paciente e do profissional, com a seção de posologia | Sem API estável e contratada. O JSON interno de `consultas.anvisa.gov.br` muda sem aviso | Fora da v1. Fatia opcional F8, com trecho citado |

O import é um script offline (`server/scripts/import-anvisa.mjs` ou equivalente), rodado à mão quando sair lista nova. Ele gera linhas em `anvisa_presentations` e não chama LLM. A tabela não é por cuidador. `pg_trgm` na migração 008 (a imagem Postgres do Compose cria o usuário `medica` como superusuário, então `CREATE EXTENSION` funciona ali).

Não carregar o CSV no processo Node. O limite de memória do app em produção é **512 MB**.

Match, para cada item:

1. Normalizar nome e substância: minúsculas, sem acento, sem pontuação, espaços únicos.
2. `similarity(produto_norm, nome)` e o mesmo para substância, com `pg_trgm`, limite 5.
3. Subir o candidato cuja `apresentacao` contém a concentração lida (500 mg, 500 mg/mL), se ela existir.
4. Limiares iniciais, para ajustar com fotos reais: ≥ 0,85 e concentração compatível → um candidato pré-selecionado, selo alto, origem Anvisa/CMED. Entre 0,55 e 0,85, ou concentração conflitante → lista, nada pré-selecionado, campos oficiais vazios. Abaixo de 0,55 → sem candidatos.
5. Concentração conflitante **nunca** preenche `concentration` com o valor do modelo. Ou vem da linha escolhida pela pessoa, ou fica vazia.
6. Registro só é copiado da linha. O modelo não tem campo de registro.
7. Medicamento manipulado, amostra, importado sem registro ou nome que não está na base: cadastro segue com o que foi lido na foto e com os oficiais vazios. O selo do nome é o da visão, no máximo médio, com o texto “sem correspondência na base da Anvisa”.

Posologia usual e indicação clínica não estão nesses CSVs. Pedir isso ao modelo “porque ele conhece o remédio” é o caminho da alucinação (dose de adulto em criança, concentração trocada, indicação de outro fármaco parecido — losartana e losartana potássica, dipirona sódica e monoidratada). Por isso a v1 deixa `indication` e `reference_posology` vazios. A classe terapêutica fica só na UI do candidato.

Fatia F8, se for feita: baixar o PDF da bula do paciente pelo registro já confirmado, extrair o texto da seção de posologia **no servidor**, mandar só esse texto (sem a foto, sem dados do paciente) numa segunda chamada, e gravar `reference_posology` junto com o trecho e a URL ou o identificador do PDF. Sem PDF, o campo continua vazio. Sem raspagem do bulário no pedido da foto.

### 5.5 O que a confirmação reutiliza

O POST de confirmação monta o body que `parseMedicationBody` e `parseTreatmentBody` já aceitam. Não há um segundo validador de nome, intervalo ou horário.

- Nome duplicado: não criar outro. A pessoa confirma “usar o existente”. O tratamento, se houver, aponta para `existingId`. Campos oficiais novos (concentração, registro) **não** sobrescrevem o medicamento existente nesta v1; a edição continua no formulário do catálogo. Evita que uma leitura ruim altere um cadastro já em uso.
- Foto de **embalagem** confirmada: o JPEG normalizado é copiado para `med-photos/{caregiver_id}/{uuid}.jpg` e vira `photo_path`, pelo mesmo critério de magic bytes. A cópia de trabalho em `intake-photos/` é apagada.
- Foto de **receita** confirmada: não vira `photo_path`. Thumbnail de receita no catálogo exporia o paciente na lista de medicamentos. A imagem segue a retenção da seção 9.
- Tratamento: `createTreatment` gera a grade como hoje. `posology_origin = prescription_confirmed` quando o esquema saiu da receita e a pessoa confirmou; `manual` quando ela mudou quantidade, via ou horário em relação ao rascunho.
- Pré-visualização na revisão chama o preview já existente e não grava `scheduled_doses`.

---

## 6. Modelos, custo e latência

Preços públicos da OpenRouter por 1 milhão de tokens, conferidos em fontes de outubro de 2026 (páginas da OpenRouter e tabelas derivadas, por volta de 12–21/10/2026). **Revalidar no dia em que a fatia F2 for implementada.** O número abaixo é ordem de grandeza para decidir, não um contrato.

Conta de uma foto já reduzida (lado maior 1600 px, JPEG):

- imagem ≈ 1 000 a 1 600 tokens (a fórmula muda por provedor; Gemini conta diferente da OpenAI);
- prompt ≈ 900 tokens;
- JSON de saída ≈ 700 tokens;
- **uma** chamada. A bula seria outra chamada, só na F8, e só texto.

| Opção | Entrada / saída por 1M | Custo por foto | Latência típica | Visão | Retenção no caminho OpenRouter |
|---|---|---|---|---|---|
| **`openai/gpt-4.1-mini` (recomendado)** | US$ 0,40 / US$ 1,60 | **≈ US$ 0,002** | 5–15 s; p95 até ~25 s | Sim | Pedir `data_collection: "deny"`. Confirmar se o endpoint ainda entra nesse filtro |
| `google/gemini-2.5-flash-lite` | US$ 0,10 / US$ 0,40 | ≈ US$ 0,0005 | 2–8 s (p50 de fila ~0,5 s; a imagem alonga) | Sim | Relato de 18/10/2026: Gemini na OpenRouter deixou de ser ZDR |
| `google/gemini-2.5-flash` | US$ 0,30 / US$ 2,50 | ≈ US$ 0,0025 | 6–20 s | Sim | O mesmo ponto de ZDR |
| `anthropic/claude-haiku-4.5` | US$ 1,00 / US$ 5,00 | ≈ US$ 0,006 | 4–12 s | Sim | Em geral elegível a ZDR; confirmar na página do modelo |
| `openai/gpt-4.1` | US$ 2,00 / US$ 8,00 | ≈ US$ 0,01 | 8–20 s | Sim | Qualidade maior, custo ~5× o mini, sem necessidade no volume atual |
| `typesafe/jev-router` | o do modelo que ele escolher | sem teto (pode ir a um modelo de fronteira) | variável | Só se o escolhido tiver visão | Subprocessador muda por pedido. Região global, não EU |
| DeepSeek V4.1 Flash (visão nativa anunciada) | ordem de US$ 0,014 / US$ 0,14 | fração de centavo | a medir | Anunciada | Provedor e política de treino a confirmar; não é o default |
| 9router em si | US$ 0 no proxy | o do upstream | soma o hop local | depende do alias | A imagem continua até o provedor final |

Volume doméstico: 30 fotos/mês ficam abaixo de US$ 0,10 no mini e abaixo de US$ 0,02 no Flash-Lite. Quinhentas fotos ainda ficam na casa de US$ 1 a US$ 2 no mini. O teto de gasto existe para loop de retry e chave vazada, não porque a unidade seja cara. Proposta: **US$ 5 por mês** e **30 análises por dia** por cuidador (há um cuidador no MVP).

Por que o mini e não o Flash-Lite, apesar do preço: a foto da receita sai do país e pode trazer dado de saúde de outra pessoa (o paciente). O critério de desempate é subprocessador estável e política de não usar o conteúdo para treino, não o centavo. Flash-Lite volta a ser a escolha se a política Google/OpenRouter for aceita por escrito na pergunta em aberto.

Por que não Jev aqui: a documentação da OpenRouter descreve o Jev Router como um modelo que **escolhe** outro modelo e o esforço de raciocínio por pedido, cobrando o preço desse outro modelo. Não há preço fixo. Para código no 9router isso é cômodo. Para uma receita, o aviso de LGPD precisa nomear quem recebe a imagem, e o schema JSON precisa ser honrado. Um roteador que pode cair num modelo sem `json_schema` ou sem visão quebra os dois.

9router ([decolua/9router](https://github.com/decolua/9router), endpoint OpenAI em `http://localhost:20128/v1` no uso local) entra como **transporte**, não como modelo. Serve para o Altamir apontar `AI_BASE_URL` ao roteador que já usa, com `AI_MODEL` num alias de visão **pinado** e fallback automático desligado nessa rota. No container da VPS, `localhost` é o próprio app: o 9router teria de estar na rede Docker, e a imagem da receita ainda seguiria para o upstream. Não é o default de produção. Não colocar a chave do 9router no repositório.

Implementação do cliente: `fetch` com timeout, sem SDK obrigatório. Corpo no formato chat completions. Para a OpenRouter, headers `HTTP-Referer` = `https://medica-certo.altamir.dev` e `X-Title` = `Medica Certo`, mais:

```json
"provider": { "data_collection": "deny", "allow_fallbacks": false, "require_parameters": true }
```

`require_parameters` evita provedor que ignore `response_format`. Se a OpenRouter responder que não há endpoint elegível, a fatia F2 falha o pedido com `AI_UNAVAILABLE` e a UI oferece o cadastro manual. Não há queda silenciosa para um provedor que armazena o prompt. Alternativa de configuração, se o filtro esvaziar a rota do mini: `AI_BASE_URL=https://api.openai.com/v1` direto, mesma forma de pedido, modelo `gpt-4.1-mini`.

Uma retentativa só quando o HTTP foi 200 e o JSON não valida. Timeout e 5xx não disparam segunda imagem automaticamente (a pessoa é que clica em tentar de novo), para não dobrar custo num provedor instável.

---

## 7. Mudanças de dados

Migração proposta: `server/migrations/008_medication_ai.sql`. Numeração lexical, transação por arquivo, registro em `schema_migrations` — o mesmo `server/migrate.mjs`.

### 7.1 Colunas novas em `medications`

O catálogo já guarda princípio ativo, indicação e posologia de referência. Faltam a composição no sentido de concentração/apresentação, a origem e o vínculo com a leitura.

| Coluna | Tipo | Notas |
|---|---|---|
| `concentration` | `text NULL` | Ex.: `500 mg`, `500 mg/mL`. Até 80 caracteres, vazio rejeitado se não for NULL |
| `presentation` | `text NULL` | Ex.: comprimido revestido, frasco 20 mL. Até 200 |
| `anvisa_registry` | `text NULL` | Só dígitos, 9 ou 13. Nunca preenchido pelo modelo |
| `catalog_origin` | `text NOT NULL DEFAULT 'manual'` | `manual` ou `ai_confirmed` |

`active_ingredient` continua sendo o princípio ativo (um ou vários, texto). `concentration` não é concatenada nele, para a busca atual por princípio ativo não quebrar. A UI pode mostrar “dipirona · 500 mg”.

`catalog_origin = ai_confirmed` significa que a pessoa confirmou um rascunho de IA, mesmo que tenha editado o nome. Não significa que a Anvisa confirmou.

Não colocar JSON do modelo nem caminho da receita em `medications`. A lista do catálogo não deve precisar saber de PHI.

### 7.2 Coluna nova em `treatments`

| Coluna | Tipo | Notas |
|---|---|---|
| `posology_origin` | `text NULL` | `manual`, `prescription_confirmed`. NULL nos tratamentos já existentes |
| `posology_raw` | `text NULL` | Frase lida na receita, até 500, para o detalhe do tratamento. Não entra na grade |

A grade continua saindo de `dose_quantity`, `route`, `interval_hours` / `times_of_day`. Sem coluna paralela de “dose da IA”.

### 7.3 `caregivers`

| Coluna | Tipo |
|---|---|
| `ai_image_consent_at` | `timestamptz NULL` |
| `ai_image_consent_provider` | `text NULL` |
| `ai_image_consent_model` | `text NULL` |

O aceite só vale se provedor e modelo gravados baterem com a config atual.

### 7.4 Rascunho e auditoria

`medication_drafts` — uma foto, um cuidador, zero ou mais itens no JSON já validado.

| Coluna | Notas |
|---|---|
| `id uuid PK` | |
| `caregiver_id` | FK, `ON DELETE CASCADE`. Toda leitura filtra por ele |
| `patient_id uuid NULL` | FK `ON DELETE SET NULL`. Só na rota do paciente |
| `status` | `processing`, `ready`, `failed`, `confirmed`, `discarded`, `expired` |
| `document_kind` | `package`, `prescription`, `unknown`, ou NULL enquanto processa |
| `image_path text NOT NULL` | Relativo a `intake-photos/`. Mesma checagem de escape de `resolvePhotoAbsolutePath` |
| `image_sha256 text NOT NULL` | Dedup e auditoria, não é segredo |
| `mime_type` | O tipo **depois** da regravação JPEG no servidor |
| `error_code text NULL` | `AI_UNAVAILABLE`, `AI_TIMEOUT`, `AI_INVALID_OUTPUT`, `VALIDATION` |
| `model_provider`, `model_name`, `prompt_version` | O que de fato atendeu |
| `extracted jsonb NULL` | Saída já filtrada pelo schema. Pode conter posologia |
| `candidates jsonb NULL` | Até 5 linhas Anvisa/CMED por item, sem preço (preço não é desta feature) |
| `confirmed_medication_ids uuid[]` | Preenchido na confirmação |
| `confirmed_treatment_ids uuid[]` | Idem |
| `expires_at timestamptz NOT NULL` | Criação + 24 h para quem não confirmou |
| `image_purge_at timestamptz NULL` | Para receita confirmada, criação + 30 dias (proposta) |
| `created_at`, `updated_at` | |

Índice `(caregiver_id, status, created_at)`.

`medication_ai_events` — uma linha por chamada ao provedor, sem prompt e sem imagem.

| Coluna | Notas |
|---|---|
| `id`, `caregiver_id`, `draft_id` | `draft_id` pode ficar órfão se o rascunho for apagado: `ON DELETE SET NULL` ou manter o evento sem FK. Preferência: manter o evento e `ON DELETE SET NULL`, porque o teto de custo não pode sumir com o rascunho |
| `provider`, `model`, `prompt_version` | |
| `input_tokens`, `output_tokens` | Inteiros, 0 se o provedor não devolver usage |
| `estimated_cost_usd numeric(12,6)` | Calculado com a tabela de preço da config, não com a fatura |
| `latency_ms`, `http_status` | |
| `outcome` | `ok`, `invalid_output`, `timeout`, `http_error` |
| `created_at` | |

Sem coluna de corpo da resposta. O JSON filtrado mora no rascunho, com prazo. Log de aplicação (stdout JSON) registra `draft_id`, `outcome`, `latency_ms`, `model`. Não registra o JSON nem o path absoluto.

`ai_usage_daily`:

| Coluna | Notas |
|---|---|
| `caregiver_id`, `usage_date date` | PK composta |
| `request_count int` | Incremento na ida ao provedor, não no poll |
| `estimated_cost_usd numeric(12,6)` | |

`anvisa_presentations` (dados públicos, sem cuidador):

`registro` (text), `registro_produto` (9 dígitos), `produto`, `substancia`, `apresentacao`, `laboratorio`, `ean`, `tarja`, `classe_terapeutica` NULL, `situacao_registro` NULL, `produto_norm`, `substancia_norm`, `imported_at`.

Índice GIN trigram em `produto_norm` e `substancia_norm`. A carga pode ter dezenas de milhares de apresentações. Isso cabe no Postgres de 256 MB se a tabela for só texto enxuto; o import deve ignorar colunas de preço.

### 7.5 Arquivos

| Caminho | Volume | Conteúdo |
|---|---|---|
| `data/med-photos/{caregiver_id}/{uuid}.jpg` | já montado | Foto de **embalagem** promovida ao catálogo. Retenção igual à de hoje: enquanto o medicamento existir |
| `data/intake-photos/{caregiver_id}/{draft_id}.jpg` | **volume novo** nos dois Compose | Trabalho da análise e, por prazo curto, a receita confirmada |

Sem o volume novo, a receita cai no filesystem do container e some no deploy — ou pior, um deploy no meio da análise perde o arquivo e o poll quebra. O `deploy.sh` precisa criar o diretório e entregar ao uid `1000`, como já faz com `med-photos`.

Regravar o JPEG no servidor (decoder + encoder) mesmo que o browser já tenha reduzido, para garantir ausência de EXIF/GPS. Magic bytes JPEG na saída. A dependência nova fica para a fatia de implementação (`sharp` é o candidato; pesa no build da imagem Docker — avaliar nessa fatia, sem adicionar agora).

---

## 8. API

Tudo sob sessão, `caregiver_id` da sessão em toda query. Plugin multipart **à parte** do de medicamentos, para o limite de 2 MB do catálogo não subir.

| Método | Path | Efeito |
|---|---|---|
| `POST` | `/api/medication-drafts` | Multipart `image` e `patientId` opcional. 202 `{ draft }` com `status: processing`. 400 imagem inválida. 404 se IA desligada. 403 sem consentimento. 429 limite. 409 se já houver `processing` desse cuidador |
| `GET` | `/api/medication-drafts/:id` | Estado, campos, candidatos, erros. Sem vazar path de disco |
| `GET` | `/api/medication-drafts/:id/image` | Stream autenticado, `private, no-cache`, `nosniff` |
| `POST` | `/api/medication-drafts/:id/confirm` | Body editado. 201 com medicamento e tratamento opcional. 200 se já confirmado (idempotente). 409 nome duplicado, com `existingId`, **sem** gravar |
| `DELETE` | `/api/medication-drafts/:id` | Descartar. 204. Apaga o arquivo |

Códigos novos, no mesmo envelope: `AI_DISABLED`, `AI_UNAVAILABLE`, `AI_TIMEOUT`, `AI_INVALID_OUTPUT`, `AI_BUDGET`, `CONSENT_REQUIRED`. Limite diário reutiliza `RATE_LIMITED`.

O confirm de tratamento manda `patientId` igual ao do rascunho. Um `patientId` diferente no body é `VALIDATION`. Sem paciente no rascunho, `createTreatment` no body é `VALIDATION`.

`GET /api/medications` passa a devolver `concentration`, `presentation`, `anvisaRegistry`, `catalogOrigin` para o formulário de edição mostrar. A busca ganha `concentration` só na exibição, não precisa entrar no `ILIKE` na v1.

---

## 9. Segurança, privacidade e LGPD

Receita e anotação de tratamento são dado pessoal sensível de saúde (LGPD, art. 5º, II). O titular é o paciente. Quem opera o app, hoje, é o cuidador, e o paciente não tem login. O controlador da instância `medica-certo.altamir.dev` passa a tratar dado de saúde de terceiros assim que uma receita é enviada. O MVP de um cuidador não tira essa obrigação; só reduz a escala.

Base prática para este produto caseiro: consentimento destacado do cuidador (art. 11, I), com frase de que ele só envia receita de paciente que ele cuida e de cujo tratamento ele é responsável. Isto é produto e aviso, não parecer jurídico. Se o uso deixar de ser o caderno pessoal do Altamir, a base legal precisa ser revista antes.

### 9.1 O que vai para o provedor de IA

Vai:

- o JPEG regravado, lado maior ≤ 1600 px, sem EXIF;
- o prompt fixo de versão `prompt_version` e o schema;
- nada de identificador da conta.

Não vai:

- e-mail, nome do cuidador, id do paciente, data de nascimento, catálogo, outras fotos;
- a resposta anterior de outro rascunho (cada análise é um pedido novo, sem histórico de chat);
- ferramenta de busca na web, plugin de fetch ou “deixe o modelo consultar a Anvisa”. A Anvisa é consulta SQL local.

O que a imagem ainda pode levar, se for receita: nome do paciente, documento, CRM, carimbo, às vezes CID ou endereço do consultório. O prompt manda o modelo não ecoar isso, e o servidor corta chaves desconhecidas. Isso reduz o que fica no Postgres. **Não** tira o dado do provedor que já recebeu a imagem. O aviso tem de dizer essa frase, não uma versão suavizada.

Transferência internacional: OpenRouter e OpenAI processam fora do Brasil (art. 33). O texto de consentimento nomeia o provedor configurado (“a imagem é enviada à OpenAI via OpenRouter” ou “ao provedor configurado no 9router: …”). Troca de `AI_MODEL` invalida o aceite.

`data_collection: deny` e, no dia da implementação, checagem de que o endpoint escolhido ainda aparece como elegível. Sem queda para outro provedor. Gemini fica condicionado à pergunta em aberto por causa do ZDR.

9router com fallback para “provedor grátis” é incompatível com este fluxo: a receita iria para um subprocessador que o aviso não nomeou.

### 9.2 Retenção

| Dado | Prazo proposto | Apagar significa |
|---|---|---|
| Rascunho não confirmado e a imagem | 24 h (`expires_at`) | Arquivo removido, status `expired`, `extracted` anulado |
| `processing` abandonado | 2 min → `failed`; a imagem segue a regra das 24 h | |
| Foto de embalagem no catálogo | Enquanto o medicamento existir (igual hoje) | `deleteMedication` já remove `photo_path` |
| Imagem de receita depois de confirmar | **30 dias** (`image_purge_at`), depois o arquivo some e `image_path` anula | Os campos que a pessoa confirmou (nome, dose, horários) permanecem: são o caderno |
| `extracted` do rascunho confirmado | 30 dias, junto com a imagem | Depois guarda só ids confirmados, modelo, `prompt_version` e o hash |
| `medication_ai_events` e `ai_usage_daily` | 12 meses | Sem conteúdo clínico; serve ao teto de custo |
| Log stdout | O que o Docker já rotaciona (`max-size` 10 MB no Compose da VPS) | Proibido logar body da IA |

O expurgo roda no scheduler in-process, a cada ciclo ou no máximo a cada 15 min. Falha de apagar arquivo é logada e tentada de novo; a linha não fica `expired` enquanto o arquivo existir.

Proposta de 30 dias é conservadora para o cuidador conferir uma leitura. Apagar a receita no ato da confirmação é mais alinhado à minimização, e está na lista de perguntas. Até lá, o plano implementa 30 dias **só se** a resposta for essa. Se não houver resposta, a implementação para na F6 sem ligar `AI_ENABLED` em produção — a F7 não escolhe o prazo no lugar do Altamir. Para desenvolvimento, o default do código pode ser 24 h também na receita confirmada (o mais curto), e a env `AI_PRESCRIPTION_RETAIN_DAYS` sobe para 30 só com decisão explícita.

### 9.3 Limites e custo

| Controle | Valor proposto | Onde vive |
|---|---|---|
| Tamanho de upload | 8 MB | multipart do plugin de rascunho |
| Imagem guardada | JPEG ≤ 1600 px | servidor |
| Timeout da chamada | 45 s | `AbortSignal` |
| Retentativa automática | 1, só JSON inválido com HTTP 200 | memória do pedido |
| Em voo | 1 rascunho `processing` por cuidador | Postgres |
| Por dia | 30 chamadas | `ai_usage_daily` |
| Por hora | 10 chamadas | limitador em memória (réplica única), além do diário |
| Por mês | US$ 5 estimados | soma de `ai_usage_daily` no mês corrente |
| IA desligada | `AI_ENABLED` diferente de `1` | rota 404, botão oculto |

O contador diário incrementa **antes** da chamada, na mesma transação que cria o evento em estado pendente, para dois cliques não passarem. Estouro responde 429 `RATE_LIMITED` ou 429 `AI_BUDGET` sem chamar o provedor.

Custo estimado usa preços em env (`AI_PRICE_INPUT_PER_MILLION`, `AI_PRICE_OUTPUT_PER_MILLION`), default iguais aos do gpt-4.1-mini da tabela. Se o uso não vier na resposta, estimar 3 000 tokens de entrada e 800 de saída (para cima), para o teto não ficar cego.

Chave de API só em ambiente, nunca no repositório, no log ou no cliente. O browser não fala com a OpenRouter. A chave no `.env` da VPS segue o padrão já descrito no README (`chmod 600`, o workflow não envia o arquivo).

### 9.4 Outros pontos já verdadeiros no app, que este fluxo precisa continuar respeitando

- Cookie de sessão `HttpOnly`. Sem rota pública de imagem.
- IDOR: rascunho de outro cuidador é 404, não 403.
- SQL parametrizado. Path da foto resolvido por baixo de um root, como `resolvePhotoAbsolutePath`.
- Payload de push continua genérico. Alarme não ganha posologia nova.
- Aviso permanente na revisão e no detalhe do tratamento quando `posology_origin = prescription_confirmed`: “Conferido por você a partir de uma leitura automática. Não substitui o médico nem a bula.”
- CSP atual não precisa liberar domínio de IA: a chamada é servidor para servidor.
- Testes de unidade não batem na rede. O cliente HTTP é injetável, no estilo dos testes atuais em `node --test`.

---

## 10. Variáveis de ambiente

Novas, todas opcionais. Com ausência ou `AI_ENABLED` desligado, o app sobe como hoje. Documentar em `.env.example` e `deploy/env.vps.example` na fatia F7, não neste PR.

O Compose da VPS usa `env_file: .env` e um bloco `environment:` que **não** lista estas chaves. `env_file` já as injeta, desde que não sejam sobrescritas pelo bloco. Não é obrigatório duplicá-las no YAML. Conferir na F7 que nenhuma delas é apagada pelo merge de `environment`.

| Variável | Exemplo | Função |
|---|---|---|
| `AI_ENABLED` | `0` | `1` liga rotas e botão. Default `0` |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | Sem barra final. 9router: URL alcançável **a partir do container** |
| `AI_API_KEY` | — | Bearer. Vazio com `AI_ENABLED=1` impede o boot ou trata como desligado — preferir falhar o boot, para não achar que a feature está no ar |
| `AI_MODEL` | `openai/gpt-4.1-mini` | Slug pinado. Sem default oculto para Jev |
| `AI_PROVIDER_NAME` | `OpenAI via OpenRouter` | Texto do aviso de consentimento. Obrigatório se `AI_ENABLED=1` |
| `AI_TIMEOUT_MS` | `45000` | |
| `AI_MAX_UPLOAD_BYTES` | `8388608` | 8 MB |
| `AI_DAILY_LIMIT` | `30` | Por cuidador |
| `AI_HOURLY_LIMIT` | `10` | Por cuidador |
| `AI_MONTHLY_BUDGET_USD` | `5` | Estimativa |
| `AI_PRICE_INPUT_PER_MILLION` | `0.40` | |
| `AI_PRICE_OUTPUT_PER_MILLION` | `1.60` | |
| `AI_HTTP_REFERER` | `https://medica-certo.altamir.dev` | Header da OpenRouter. Vazio se a base não for OpenRouter |
| `AI_APP_TITLE` | `Medica Certo` | Header `X-Title` |
| `AI_DATA_COLLECTION` | `deny` | `deny` ou `allow`. Default `deny`. `allow` em produção deve exigir a pergunta em aberto respondida |
| `AI_PRESCRIPTION_RETAIN_DAYS` | `1` | Dias de arquivo depois de confirmar receita. `0` apaga na confirmação. Subir para 30 só com decisão |
| `AI_PROMPT_VERSION` | `v1` | Opcional; pode ser constante no código. Útil para invalidar aceite se um dia o prompt passar a pedir mais dados |

Não adicionar `AI_API_KEY` em workflow do GitHub. O deploy não reconstrói o `.env`.

Snapshot Anvisa não é env de segredo. O script de import recebe um caminho local. Fora do pedido HTTP.

---

## 11. Fatias

Cada fatia é um PR pequeno, testável, e **também não deve ser mergeado na `main` sem o aceite do Altamir** — o merge publica em `medica-certo.altamir.dev`.

A ordem é a de dependência. F7 é pré-requisito para `AI_ENABLED=1` em produção. F8 é opcional.

### F0 — Este documento

Entrega: `docs/planejamento/cadastro-medicamento-ia.md` e o PR contra `main`, sem merge.

Aceite:

- O diff não altera `server/`, `web/`, migração, Compose nem workflow.
- A recomendação, as fatias e as perguntas em aberto estão no texto.

### F1 — Rascunho e confirmação manual, sem modelo

Entrega: migração 008 com as tabelas e colunas, volume `intake-photos` documentado no Compose, `POST/GET/DELETE` do rascunho, tela de captura e revisão com campos **vazios**, confirmar cria medicamento pelos parsers atuais. Botão visível só com uma flag de UI ainda desligada por default, ou atrás de `AI_ENABLED` — como a IA não é chamada, a flag desta fatia pode ser `AI_DRAFTS_ENABLED` só em dev. Preferência: rotas existem, botão atrás de `AI_ENABLED`, testes chamam a rota direto. Assim produção não mostra o fluxo.

Aceite:

- JPEG/PNG/WebP válido cria rascunho `ready` com `extracted` nulo (não houve modelo).
- Arquivo que não bate magic bytes → 400, zero linhas, zero arquivos órfãos.
- Confirmar grava medicamento com `catalog_origin = ai_confirmed` e, se a foto for marcada embalagem pela pessoa, `photo_path` preenchido.
- Descartar e expirar não deixam linha em `medications`.
- Rascunho de outro cuidador → 404.
- Teste em `server/*.test.mjs` (`node --test`), sem Postgres se o padrão atual dos testes de medicamento for esse; onde precisar de SQL, separar e não exigir rede.

### F2 — Leitura da imagem

Entrega: cliente OpenAI-compatível injetável, schema, prompt `v1`, poll, tela “Lendo a foto”. Sem Anvisa ainda. Confiança é a do modelo, já rebaixada pelo regex de posologia.

Aceite:

- Teste com HTTP mockado: resposta válida preenche nome e, no JSON de receita, quantidade, via mapeada e intervalo.
- JSON inválido → uma retentativa mockada → `failed` + `AI_INVALID_OUTPUT` se a segunda também falhar.
- Timeout → `failed` + `AI_TIMEOUT`, uma única chamada.
- A resposta mockada com CPF ou registro Anvisa não aparece no `extracted` guardado.
- Nenhum teste abre socket real.
- `medications` continua vazio até o confirm da F1.

### F3 — Revisão de verdade

Entrega: selos, origens, campos editáveis, aviso de que não substitui o médico, fluxo de nome duplicado, “usar o existente”.

Aceite:

- Confirmar com nome editado grava o nome editado.
- `409 DUPLICATE_NAME` não cria linha nova; a ação de reutilizar devolve o `existingId` e não altera princípio ativo do registro antigo.
- O aviso está na tela de revisão (teste de componente ou checagem do texto na página, conforme o que o `web` já usar; se não houver teste de página, um teste do contrato do confirm mais a presença da string no fonte da página — e a verificação manual descrita no PR).
- Sair da revisão sem confirmar não cria medicamento.

### F4 — Snapshot Anvisa/CMED

Entrega: tabela `anvisa_presentations`, script de import da planilha CMED (e, se o arquivo existir, complemento do CSV de consulta), match com limiares, seletor de candidatos.

Aceite:

- Teste do normalizador e do match contra um fixture de poucas linhas (paracetamol/dipirona 500 mg), sem baixar a Anvisa no CI.
- Nome inventado pelo modelo não ganha `anvisa_registry`.
- Concentração da foto diferente da linha não pré-seleciona o candidato.
- `indication` permanece vazio mesmo quando a classe terapêutica veio no fixture.
- O processo Node não lê o CSV de 114 MB no boot.

### F5 — Receita vira tratamento (um item)

Entrega: rota do paciente, mapeamento de via e esquema, `endsOn` / contínuo, preview da grade na revisão, `posology_origin` e `posology_raw`, foto de receita **fora** do `photo_path`.

Aceite:

- Confirmar com paciente cria tratamento e `scheduled_doses` coerentes com o preview.
- Sem `patientId`, o mesmo confirm não aceita bloco de tratamento.
- Via não mapeada chega vazia; o confirm sem via falha validação e não grava tratamento.
- “8/8h” vira `regular_interval` 8. “8h e 20h” vira `custom_times`. Discordância modelo vs regex marca confiança média no payload da revisão.
- `photo_path` do medicamento fica NULL quando `document_kind = prescription`.
- Aviso no detalhe do tratamento quando a origem é a receita.

### F6 — Vários itens na mesma receita

Entrega: lista desmarcável, confirm em transação (todos os selecionados ou nenhum, se qualquer um falhar validação).

Aceite:

- Fixture com dois medicamentos cria dois cadastros e dois tratamentos, ou só o marcado.
- Falha no segundo (nome inválido) não deixa o primeiro gravado.
- Duplicata de um deles segue a regra da F3 sem gravar o lote pela metade: a UI resolve a duplicata e reenvia.

### F7 — Privacidade operacional, antes de ligar em produção

Entrega: consentimento persistido, regravação sem EXIF, limites diário/horário/mensal, expurgo no scheduler, volume e `deploy.sh`, variáveis nos examples, boot que recusa `AI_ENABLED=1` sem chave e sem `AI_PROVIDER_NAME`, logs sem conteúdo clínico.

Aceite:

- 31ª chamada do dia não dispara HTTP (teste do contador).
- Soma estimada acima do teto → `AI_BUDGET`.
- Rascunho expirado: arquivo ausente e `extracted` nulo.
- JPEG de teste com comentário EXIF/GPS, depois da regravação, não contém o marcador GPS (teste no buffer).
- Consentimento ausente → `CONSENT_REQUIRED` e zero chamadas.
- Trocar `AI_MODEL` no config do teste invalida o aceite.
- `AI_ENABLED=0` → POST 404.
- Checklist manual do PR: `.env` da VPS ainda não recebe a chave até o Altamir pedir para ligar.

### F8 — Posologia usual a partir da bula (opcional)

Só com registro já escolhido na F4. Segunda chamada, só com o texto da seção, trecho citado gravado junto de `reference_posology`. Sem PDF, campo vazio. Sem esta fatia, o produto já cumpre o pedido principal: nome, composição ancorada e tratamento confirmado pela pessoa.

Aceite:

- Fixture de texto de bula preenche `reference_posology` com o trecho.
- Fixture sem seção de posologia deixa o campo vazio e não chama de novo.
- A foto não é reenviada nessa chamada.

---

## 12. Riscos

| Risco | Efeito | Mitigação no plano |
|---|---|---|
| Manuscrito ilegível | Dose ou nome errados | Confiança baixa, campo vazio, pessoa confirma. Sem gravação automática |
| Nomes parecidos ou concentração trocada | Tratamento com o fármaco errado | Match Anvisa não pré-seleciona se a concentração diverge; registro não vem do modelo |
| Vários remédios na receita | Cadastra o item errado | F5 um item com aviso; F6 lista explícita |
| Manipulado / sem registro | Match vazio | Cadastro segue manualmente confirmado, sem registro inventado |
| `reference_posology` copiada para a dose no fluxo antigo | Quantidade da dose vira um parágrafo | Fluxo novo não usa esse atalho |
| Via fora da lista aceita pelo parser frouxo | Esquema com via lixo | Mapper só emite `ROUTE_OPTIONS` ou vazio |
| HEIC | Foto da galeria do iPhone rejeitada | Mensagem clara. Conversão fica fora da v1 |
| Timeout do proxy | Pessoa acha que travou | 202 + poll, timeout de modelo 45 s |
| Processo morre durante a leitura | Rascunho eterno em `processing` | Expurgo aos 2 min |
| CSV grande no boot | OOM nos 512 MB | Import para Postgres, query pontual |
| `pg_trgm` | Extensão a mais | Disponível no Postgres 16 do Compose |
| Gemini sem ZDR | Receita retida no provedor | Default é gpt-4.1-mini com `data_collection: deny`; Gemini só com aceite |
| Jev ou fallback do 9router | Subprocessador e custo imprevisíveis | Modelo pinado, `allow_fallbacks: false` |
| Chave no cliente ou no log | Vazamento e custo | Chamada só no servidor; teto mensal |
| Merge deste ou de um PR seguinte | Deploy de produção | PRs sem merge até o Altamir aprovar. F0 não muda o app; mesmo assim o workflow de `main` faria rebuild se alguém mergear |
| PRD desatualizado | Escopo “receita fora do MVP” contradiz a feature | Atualizar o PRD na fatia que implementar a F5 |
| Expectativa clínica | Alguém segue dose alucinada | Aviso fixo, campos oficiais vazios sem fonte, confirmação obrigatória |
| Único cuidador hoje | Limites “por cuidador” viram limite global | Aceitável no MVP. Multi-cuidador reabre isolamento do snapshot (o snapshot é público) e do consentimento |

---

## 13. Perguntas para o Altamir decidir

1. **Provedor da v1.** Seguir com OpenRouter + `openai/gpt-4.1-mini`, `data_collection: deny` e sem fallback? Ou aceitar Gemini 2.5 Flash-Lite (mais barato e mais rápido, sem ZDR na OpenRouter desde o relato de 18/10/2026)? Ou o 9router na VPS, com qual URL a partir do container?
2. **O que “Jev” aponta no 9router.** É o `typesafe/jev-router` (roteador que escolhe o modelo) ou um alias fixo de um modelo de visão? A recomendação é não usar o roteador Jev neste fluxo. Confirma?
3. **Receita com vários medicamentos.** A primeira versão útil (F5) cadastra um item, com aviso se houver outros, e a F6 cadastra a lista? Ou a lista é obrigatória já na primeira entrega?
4. **Quanto tempo a imagem da receita permanece depois do “Cadastrar”.** Apagar no ato (`AI_PRESCRIPTION_RETAIN_DAYS=0`), 24 h, ou 30 dias? O código, sem resposta, fica em 24 h e a produção permanece com a IA desligada.
5. **Foto de embalagem vira a foto do catálogo?** A recomendação é sim. A de receita nunca vira thumbnail. Confirma os dois?
6. **Medicamento sem registro** (manipulado, amostra). Cadastrar mesmo assim, só com o que foi lido, é o comportamento desejado?
7. **Classe terapêutica** pode aparecer como dica na revisão. Ela não deve ser salva em `indication`. Confirma?
8. **“Por 7 dias”** inclui o dia de início (data fim = início + 6 dias)? A pré-visualização mostra a grade antes de gravar de qualquer forma.
9. **Tetos.** 30 leituras por dia e US$ 5 estimados por mês servem? O volume real deve ficar muito abaixo.
10. **PRD.** Na implementação, atualizar a linha que coloca receita fora do MVP, deixando claro que o sistema não prescreve?
11. **Ligação em produção.** Quem cola `AI_API_KEY` no `.env` da VPS e em que momento? A sugestão é só depois da F7 revisada, com `AI_ENABLED=1` num deploy que você aprove.
12. **Bula (F8).** Quer posologia usual citada da bula nesta leva, ou o catálogo segue com posologia de referência vazia até uma leva futura?

---

## 14. Fora deste plano

- Prescrição emitida pelo app, interação medicamentosa, ajuste por idade ou peso, dose pediátrica calculada.
- Estoque, código de barras como fluxo principal (o EAN da CMED pode ajudar o match no futuro; não há leitor na v1).
- Treinar ou fine-tunar modelo com as fotos.
- Mandar a imagem ao bulário, a um wrapper não oficial de bula, ou a uma busca na web do próprio modelo.
- Compartilhar o rascunho entre cuidadores.
- Converter HEIC, PDF de receita fotografada como documento (foto da folha sim; arquivo PDF não).
- Mudar o limitador de login ou o fluxo manual já em produção, além de exibir os campos novos no formulário de edição quando eles existirem.
