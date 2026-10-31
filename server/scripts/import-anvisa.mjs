/**
 * Importa um CSV da CMED ou de TA_CONSULTA_MEDICAMENTOS para anvisa_presentations.
 * Uso: node --harmony-temporal server/scripts/import-anvisa.mjs caminho.csv
 * Não baixa a Anvisa e não roda no boot.
 */
import { readFile } from 'node:fs/promises';
import { config } from '../config.mjs';
import { getPool, closeDb } from '../db.mjs';
import { normalizeDrugText } from '../ai/anvisa.mjs';

const file = process.argv[2];
if (!file) {
  console.error('Informe o CSV.');
  process.exit(1);
}

const text = await readFile(file, 'utf8');
const lines = text.split(/\r?\n/).filter((line) => line.trim());
const delimiter = lines[0]?.includes(';') ? ';' : ',';
const header = splitCsv(lines[0], delimiter).map((cell) =>
  cell.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim(),
);

const col = (...names) => {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
};

const iProduto = col('produto', 'nome_produto', 'nome produto');
const iSubstancia = col('substancia', 'principio_ativo', 'principio ativo');
const iRegistro = col('registro', 'numero_registro_produto', 'numero registro produto');
const iApresentacao = col('apresentacao');
const iLaboratorio = col('laboratorio', 'empresa_detentora_registro');
const iEan = col('ean');
const iTarja = col('tarja');
const iClasse = col('classe_terapeutica', 'classe terapeutica');
const iSituacao = col('situacao_registro', 'situacao registro');

if (iProduto < 0) {
  console.error('CSV sem coluna de produto.');
  process.exit(1);
}

const pool = getPool();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('TRUNCATE anvisa_presentations');
  let count = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line, delimiter);
    const produto = cell(cells, iProduto);
    if (!produto) continue;
    const substancia = cell(cells, iSubstancia);
    const registro = cell(cells, iRegistro).replace(/\D/g, '');
    await client.query(
      `INSERT INTO anvisa_presentations (
         registro, registro_produto, produto, substancia, apresentacao,
         laboratorio, ean, tarja, classe_terapeutica, situacao_registro,
         produto_norm, substancia_norm
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        registro || '0',
        registro.slice(0, 9),
        produto,
        substancia || null,
        cell(cells, iApresentacao) || null,
        cell(cells, iLaboratorio) || null,
        cell(cells, iEan) || null,
        cell(cells, iTarja) || null,
        cell(cells, iClasse) || null,
        cell(cells, iSituacao) || null,
        normalizeDrugText(produto),
        normalizeDrugText(substancia),
      ],
    );
    count += 1;
  }
  await client.query('COMMIT');
  console.log(`Importadas ${count} apresentações. DATABASE_URL em uso de ${config.publicHost}.`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await closeDb();
}

/**
 * @param {string} line
 * @param {string} delimiter
 */
function splitCsv(line, delimiter) {
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
 * @param {string[]} cells
 * @param {number} index
 */
function cell(cells, index) {
  if (index < 0) return '';
  return cells[index] ?? '';
}
