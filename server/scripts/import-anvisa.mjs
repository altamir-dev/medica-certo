/**
 * Importa o CSV público de medicamentos da Anvisa em anvisa_presentations.
 * Idempotente: substitui a tabela inteira numa transação.
 *
 * Na VPS, dentro do container do app (depois do merge):
 *   cd /docker/medica-certo
 *   docker compose --env-file .env --env-file image.env exec -T app \
 *     node --harmony-temporal server/scripts/import-anvisa.mjs --download
 *
 * Fonte: https://dados.anvisa.gov.br/dados/CONSULTAS/PRODUTOS/TA_CONSULTA_MEDICAMENTOS.CSV
 *
 * Arquivo local: node --harmony-temporal server/scripts/import-anvisa.mjs caminho.csv
 */
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { getPool, closeDb } from '../db.mjs';
import { normalizeDrugText } from '../ai/anvisa.mjs';
import {
  ANVISA_MEDICAMENTOS_CSV_URL,
  parseAnvisaCsv,
} from '../ai/anvisa-csv.mjs';

const arg = process.argv[2];
if (!arg) {
  console.error(
    'Use --download ou o caminho de um CSV. URL padrão:',
    ANVISA_MEDICAMENTOS_CSV_URL,
  );
  process.exit(1);
}

const download = arg === '--download';
const sourcePath = download
  ? join(tmpdir(), 'ta-consulta-medicamentos.csv')
  : arg;

if (download) {
  console.log(`Baixando ${ANVISA_MEDICAMENTOS_CSV_URL}`);
  const response = await fetch(ANVISA_MEDICAMENTOS_CSV_URL);
  if (!response.ok) {
    console.error(`Download falhou: HTTP ${response.status}`);
    process.exit(1);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(sourcePath, bytes);
  console.log(`Arquivo salvo (${bytes.length} bytes) em ${sourcePath}`);
}

const text = await readFile(sourcePath, 'latin1');
const parsed = parseAnvisaCsv(text, normalizeDrugText);
const seen = new Set();
const rows = [];
for (const row of parsed) {
  const key = `${row.registro}|${row.produtoNorm}|${row.substanciaNorm}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push(row);
}
console.log(
  `${rows.length} produtos ativos únicos (${parsed.length} linhas ativas no CSV).`,
);

const pool = getPool();
const client = await pool.connect();
const batchSize = 400;
try {
  await client.query('BEGIN');
  await client.query('TRUNCATE anvisa_presentations RESTART IDENTITY');
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const params = [];
    let n = 1;
    for (const row of batch) {
      values.push(
        `($${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++})`,
      );
      params.push(
        row.registro,
        row.registroProduto,
        row.produto,
        row.substancia,
        row.apresentacao,
        row.laboratorio,
        row.ean,
        row.tarja,
        row.classeTerapeutica,
        row.situacaoRegistro,
        row.produtoNorm,
        row.substanciaNorm,
      );
    }
    await client.query(
      `INSERT INTO anvisa_presentations (
         registro, registro_produto, produto, substancia, apresentacao,
         laboratorio, ean, tarja, classe_terapeutica, situacao_registro,
         produto_norm, substancia_norm
       ) VALUES ${values.join(',')}`,
      params,
    );
  }
  await client.query('COMMIT');
  console.log(`Importação concluída: ${rows.length} linhas.`);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await closeDb();
}
