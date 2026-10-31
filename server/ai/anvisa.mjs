/**
 * @param {string} value
 */
export function normalizeDrugText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {string} value
 */
function trigrams(value) {
  const padded = `  ${value} `;
  /** @type {Set<string>} */
  const set = new Set();
  for (let i = 0; i < padded.length - 2; i += 1) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

/**
 * @param {string} a
 * @param {string} b
 */
export function trigramSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const left = trigrams(a);
  const right = trigrams(b);
  let inter = 0;
  for (const token of left) {
    if (right.has(token)) inter += 1;
  }
  const union = left.size + right.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * @param {string} value
 */
export function concentrationTokens(value) {
  const text = normalizeDrugText(value).replace(/\s+/g, '');
  /** @type {string[]} */
  const tokens = [];
  for (const match of text.matchAll(/(\d+(?:[,.]\d+)?)(mg|mcg|g|ml|ui|%)/g)) {
    const amount = match[1].replace(',', '.');
    tokens.push(`${amount}${match[2]}`);
  }
  return tokens;
}

/**
 * @param {string} imageConcentration
 * @param {string | null | undefined} apresentacao
 */
export function concentrationRelation(imageConcentration, apresentacao) {
  const fromImage = concentrationTokens(imageConcentration);
  if (fromImage.length === 0) return 'absent';
  const fromRow = concentrationTokens(apresentacao ?? '');
  if (fromRow.length === 0) return 'unknown';
  const agrees = fromImage.some((token) => fromRow.includes(token));
  return agrees ? 'agree' : 'conflict';
}

/**
 * @param {{ produto?: string, substancia?: string, apresentacao?: string, laboratorio?: string, registro?: string, classe_terapeutica?: string, classeTerapeutica?: string }} row
 * @param {{ name: string, concentration: string }} query
 */
export function rankAnvisaCandidates(rows, query) {
  const name = normalizeDrugText(query.name);
  const ranked = rows
    .map((row) => {
      const produto = normalizeDrugText(row.produto ?? '');
      const substancia = normalizeDrugText(row.substancia ?? '');
      const score = Math.max(
        trigramSimilarity(produto, name),
        trigramSimilarity(substancia, name),
      );
      const relation = concentrationRelation(
        query.concentration,
        row.apresentacao,
      );
      return {
        registro: String(row.registro ?? ''),
        produto: row.produto ?? '',
        substancia: row.substancia ?? '',
        apresentacao: row.apresentacao ?? '',
        laboratorio: row.laboratorio ?? '',
        classeTerapeutica: row.classeTerapeutica ?? row.classe_terapeutica ?? '',
        score,
        concentrationRelation: relation,
      };
    })
    .filter((row) => row.score >= 0.55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const top = ranked[0];
  const preselect =
    top && top.score >= 0.85 && top.concentrationRelation === 'agree'
      ? top
      : null;
  return { candidates: ranked, preselect };
}

/**
 * Aplica o match. Indicação clínica não é preenchida.
 * @param {{ name: string, nameConfidence: number, nameBand: string, activeIngredient: string, concentration: string, concentrationSource: string, presentation: string, anvisaRegistry: string, classeTerapeutica: string, candidates: unknown[] }} item
 * @param {ReturnType<typeof rankAnvisaCandidates>} ranked
 */
export function applyAnvisaMatch(item, ranked) {
  item.candidates = ranked.candidates.map((row) => ({
    registro: row.registro,
    produto: row.produto,
    substancia: row.substancia,
    apresentacao: row.apresentacao,
    laboratorio: row.laboratorio,
    classeTerapeutica: row.classeTerapeutica,
    score: Number(row.score.toFixed(3)),
  }));
  const conflict = ranked.candidates.some(
    (row) => row.concentrationRelation === 'conflict',
  );
  if (!ranked.preselect) {
    item.nameConfidence = Math.min(item.nameConfidence, 0.7);
    item.nameBand = item.nameConfidence >= 0.5 ? 'media' : item.nameConfidence > 0 ? 'baixa' : 'ausente';
    if (conflict) {
      item.concentration = '';
      item.concentrationSource = '';
    }
    item.anvisaRegistry = '';
    return item;
  }
  const chosen = ranked.preselect;
  item.activeIngredient = chosen.substancia || item.activeIngredient;
  item.concentration = concentrationLabel(chosen.apresentacao) || item.concentration;
  item.concentrationSource = 'anvisa_cmed';
  item.presentation = chosen.apresentacao || item.presentation;
  item.anvisaRegistry = chosen.registro;
  item.classeTerapeutica = chosen.classeTerapeutica;
  item.nameBand = 'alta';
  item.nameConfidence = Math.max(item.nameConfidence, 0.85);
  return item;
}

/**
 * @param {string} apresentacao
 */
function concentrationLabel(apresentacao) {
  const tokens = concentrationTokens(apresentacao);
  return tokens[0] ? tokens[0].replace(/(\d)([a-z])/, '$1 $2') : '';
}
