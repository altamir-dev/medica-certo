/**
 * CSV público de medicamentos regularizados na Anvisa.
 * Atualizado no portal de dados abertos (consulta de produtos).
 * Conferido em 31/10/2026: HTTP 200, cerca de 114 MB, colunas NO_PRODUTO e SUBSTANCIAS_MEDICAMENTOS.
 */
export const ANVISA_MEDICAMENTOS_CSV_URL =
  'https://dados.anvisa.gov.br/dados/CONSULTAS/PRODUTOS/TA_CONSULTA_MEDICAMENTOS.CSV';

/**
 * @param {string} line
 * @param {string} delimiter
 */
export function splitCsvLine(line, delimiter) {
  /** @type {string[]} */
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * @param {string} header
 */
function normHeader(header) {
  return header
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * @param {string[]} headers
 * @param {string[]} names
 */
function column(headers, names) {
  for (const name of names) {
    const index = headers.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

/**
 * @param {string} text
 * @param {(value: string) => string} normalizeDrugText
 */
export function parseAnvisaCsv(text, normalizeDrugText) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = splitCsvLine(lines[0], delimiter).map(normHeader);
  const iProduto = column(headers, ['no_produto', 'nome_produto', 'produto']);
  const iSubstancia = column(headers, [
    'substancias_medicamentos',
    'principio_ativo',
    'substancia',
  ]);
  const iRegistro = column(headers, [
    'nu_registro_produto',
    'numero_registro_produto',
    'registro',
  ]);
  const iLaboratorio = column(headers, [
    'no_razao_social_empresa',
    'empresa_detentora_registro',
    'laboratorio',
  ]);
  const iApresentacao = column(headers, ['apresentacao', 'complemento']);
  const iSituacao = column(headers, ['validade_situacao', 'situacao_registro']);
  const iClasse = column(headers, ['classe_terapeutica']);
  const iEan = column(headers, ['ean']);
  const iTarja = column(headers, ['co_tarja', 'tarja']);
  if (iProduto < 0) {
    throw new Error('CSV sem coluna de produto (NO_PRODUTO ou NOME_PRODUTO).');
  }

  /** @type {object[]} */
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delimiter);
    const produto = cells[iProduto] ?? '';
    if (!produto) continue;
    const situacao = iSituacao >= 0 ? (cells[iSituacao] ?? '') : '';
    if (situacao && !/^ativo$/i.test(situacao.trim())) continue;
    const substancia = iSubstancia >= 0 ? cells[iSubstancia] ?? '' : '';
    const registro = (iRegistro >= 0 ? cells[iRegistro] ?? '' : '').replace(
      /\D/g,
      '',
    );
    rows.push({
      registro: registro || '0',
      registroProduto: registro.slice(0, 9),
      produto,
      substancia: substancia || null,
      apresentacao: iApresentacao >= 0 ? cells[iApresentacao] || null : null,
      laboratorio: iLaboratorio >= 0 ? cells[iLaboratorio] || null : null,
      ean: iEan >= 0 ? cells[iEan] || null : null,
      tarja: iTarja >= 0 ? cells[iTarja] || null : null,
      classeTerapeutica: iClasse >= 0 ? cells[iClasse] || null : null,
      situacaoRegistro: situacao || null,
      produtoNorm: normalizeDrugText(produto),
      substanciaNorm: normalizeDrugText(substancia),
    });
  }
  return rows;
}
