import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rankAnvisaCandidates, applyAnvisaMatch } from './anvisa.mjs';
import { stripJpegMetadata } from './exif.mjs';
import {
  confidenceBand,
  endsOnFromDuration,
  mapRouteText,
  reconcileReading,
  sanitizeModelPayload,
} from './extract.mjs';
import { readWithOneRetry } from './openrouter.mjs';
import { assessUsage, estimateCostUsd, readAiSettings } from './settings.mjs';

describe('readAiSettings', () => {
  it('fica desligada sem chave, sem modelo ou sem AI_ENABLED', () => {
    assert.equal(readAiSettings({}).enabled, false);
    assert.equal(
      readAiSettings({
        AI_ENABLED: '1',
        AI_API_KEY: '',
        AI_MODEL: 'deepseek/deepseek-v4.1-flash-1017',
      }).enabled,
      false,
    );
    assert.equal(
      readAiSettings({
        AI_API_KEY: 'sk',
        AI_MODEL: 'deepseek/deepseek-v4.1-flash-1017',
      }).enabled,
      false,
    );
  });

  it('liga só com flag, chave e modelo', () => {
    const settings = readAiSettings({
      AI_ENABLED: '1',
      AI_API_KEY: 'sk-test',
      AI_MODEL: 'deepseek/deepseek-v4.1-flash-1017',
    });
    assert.equal(settings.enabled, true);
    assert.equal(settings.model, 'deepseek/deepseek-v4.1-flash-1017');
    assert.equal(settings.providerName, 'OpenRouter');
    assert.equal(settings.baseUrl, 'https://openrouter.ai/api/v1');
  });
});

describe('assessUsage e custo', () => {
  const limits = {
    dailyLimit: 30,
    hourlyLimit: 10,
    monthlyBudgetUsd: 5,
  };

  it('bloqueia o 11º pedido da hora e o estouro do teto', () => {
    assert.equal(
      assessUsage({ ...limits, dailyCount: 0, hourlyCount: 10, monthCostUsd: 0 }).code,
      'RATE_LIMITED',
    );
    assert.equal(
      assessUsage({ ...limits, dailyCount: 30, hourlyCount: 0, monthCostUsd: 0 }).code,
      'RATE_LIMITED',
    );
    assert.equal(
      assessUsage({ ...limits, dailyCount: 1, hourlyCount: 1, monthCostUsd: 5 }).code,
      'AI_BUDGET',
    );
    assert.equal(
      assessUsage({ ...limits, dailyCount: 1, hourlyCount: 1, monthCostUsd: 0 }).ok,
      true,
    );
  });

  it('estima para cima quando o provedor não devolve usage', () => {
    const cost = estimateCostUsd({
      fallback: true,
      priceInputPerMillion: 0.0141,
      priceOutputPerMillion: 0.144,
    });
    assert.ok(cost > 0);
    assert.ok(cost < 0.01);
  });
});

describe('stripJpegMetadata', () => {
  it('remove APP1 com GPS e mantém o marcador da imagem', () => {
    const payload = Buffer.from('Exif\0\0GPSLatitude', 'latin1');
    const app1 = Buffer.alloc(4 + payload.length);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    app1.writeUInt16BE(payload.length + 2, 2);
    payload.copy(app1, 4);
    const sos = Buffer.from([0xff, 0xda, 0x00, 0x02]);
    const input = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sos]);
    const output = stripJpegMetadata(input);
    assert.equal(output[0], 0xff);
    assert.equal(output[1], 0xd8);
    assert.equal(output.includes(Buffer.from('GPS')), false);
    assert.equal(output.includes(Buffer.from('Exif')), false);
    assert.equal(output.includes(sos), true);
  });
});

describe('sanitizeModelPayload', () => {
  it('descarta CPF e registro inventado', () => {
    const sanitized = sanitizeModelPayload({
      documentKind: 'package',
      documentKindConfidence: 0.9,
      unreadable: false,
      cpf: '12345678901',
      patientName: 'Maria',
      items: [
        {
          name: 'Dipirona',
          nameConfidence: 0.9,
          manufacturer: null,
          presentationText: null,
          cpf: '12345678901',
          registroAnvisa: '9999999999999',
          activeIngredients: [
            { name: 'dipirona', concentration: '500 mg', confidence: 0.8 },
          ],
          schedule: {
            doseQuantity: null,
            routeText: null,
            mode: 'unknown',
            intervalHours: null,
            timesOfDay: [],
            durationDays: null,
            continuousUse: false,
            rawText: null,
            confidence: 0,
          },
        },
      ],
    });
    assert.equal(sanitized.ok, true);
    if (!sanitized.ok) return;
    const dumped = JSON.stringify(sanitized.value);
    assert.equal(dumped.includes('12345678901'), false);
    assert.equal(dumped.includes('9999999999999'), false);
    assert.equal(dumped.includes('Maria'), false);
  });
});

describe('reconcileReading', () => {
  const baseItem = {
    name: 'Dipirona',
    nameConfidence: 0.95,
    manufacturer: null,
    presentationText: null,
    activeIngredients: [
      { name: 'dipirona', concentration: '500 mg', confidence: 0.9 },
    ],
    schedule: {
      doseQuantity: '1 comprimido',
      routeText: 'via oral',
      mode: 'regular_interval',
      intervalHours: 12,
      timesOfDay: [],
      durationDays: 7,
      continuousUse: false,
      rawText: '1 comprimido via oral 8/8h por 7 dias',
      confidence: 0.95,
    },
  };

  it('rebaixa quando o texto diz 8/8h e o modelo disse 12', () => {
    const sanitized = sanitizeModelPayload({
      documentKind: 'prescription',
      documentKindConfidence: 0.9,
      unreadable: false,
      items: [baseItem],
    });
    assert.equal(sanitized.ok, true);
    if (!sanitized.ok) return;
    const reading = reconcileReading(sanitized.value, '2026-09-14T15:00:00.000Z');
    assert.equal(reading.items[0].schedule.route, 'VO');
    assert.ok(reading.items[0].schedule.confidence <= 0.7);
    assert.match(reading.items[0].schedule.disagreement ?? '', /8\/8h/);
    assert.equal(reading.items[0].schedule.endsOn, '2026-09-20');
  });

  it('não transforma via desconhecida em outra', () => {
    assert.equal(mapRouteText('tomar'), '');
    assert.equal(mapRouteText('via oral'), 'VO');
    assert.equal(confidenceBand(0.2), 'baixa');
  });
});

describe('rankAnvisaCandidates', () => {
  const rows = [
    {
      produto: 'Dipirona',
      substancia: 'dipirona sodica',
      apresentacao: '500 MG COM CT BL X 20',
      registro: '1234567890123',
      laboratorio: 'Lab',
      classe_terapeutica: 'ANALGESICOS',
    },
    {
      produto: 'Dipirona',
      substancia: 'dipirona sodica',
      apresentacao: '1 G COM CT',
      registro: '1234567890999',
      laboratorio: 'Outro',
      classe_terapeutica: 'ANALGESICOS',
    },
  ];

  it('pré-seleciona 500 mg e não grava indicação', () => {
    const ranked = rankAnvisaCandidates(rows, {
      name: 'Dipirona',
      concentration: '500 mg',
    });
    assert.equal(ranked.preselect?.registro, '1234567890123');
    const item = {
      name: 'Dipirona',
      nameConfidence: 0.4,
      nameBand: 'baixa',
      activeIngredient: '',
      concentration: '500 mg',
      concentrationSource: 'image',
      presentation: '',
      anvisaRegistry: '',
      classeTerapeutica: '',
      candidates: [],
    };
    applyAnvisaMatch(item, ranked);
    assert.equal(item.anvisaRegistry, '1234567890123');
    assert.equal(item.concentrationSource, 'anvisa_cmed');
    assert.equal('indication' in item, false);
  });

  it('não dá registro a nome inventado nem preenche concentração conflitante', () => {
    const invented = rankAnvisaCandidates(rows, {
      name: 'zzzzqqqq medicamento',
      concentration: '500 mg',
    });
    assert.equal(invented.preselect, null);
    assert.equal(invented.candidates.length, 0);

    const conflict = rankAnvisaCandidates(
      [rows[1]],
      { name: 'Dipirona', concentration: '500 mg' },
    );
    assert.equal(conflict.preselect, null);
    const item = {
      name: 'Dipirona',
      nameConfidence: 0.95,
      nameBand: 'alta',
      activeIngredient: 'dipirona',
      concentration: '500 mg',
      concentrationSource: 'image',
      presentation: '',
      anvisaRegistry: '',
      classeTerapeutica: '',
      candidates: [],
    };
    applyAnvisaMatch(item, conflict);
    assert.equal(item.anvisaRegistry, '');
    assert.equal(item.concentration, '');
  });
});

describe('readWithOneRetry', () => {
  const settings = {
    apiKey: 'sk',
    model: 'deepseek/deepseek-v4.1-flash-1017',
    baseUrl: 'https://openrouter.ai/api/v1',
    timeoutMs: 1000,
    httpReferer: 'https://medica-certo.altamir.dev',
    appTitle: 'Medica Certo',
    dataCollection: 'deny',
    promptVersion: 'v1',
  };

  it('tenta uma vez mais só quando o JSON é inválido', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const content =
        calls === 1
          ? 'não é json'
          : JSON.stringify({
              documentKind: 'package',
              documentKindConfidence: 1,
              unreadable: false,
              items: [],
            });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: settings.model,
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      };
    };
    const outcome = await readWithOneRetry({
      settings,
      image: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      fetchImpl,
    });
    assert.equal(calls, 2);
    assert.equal(outcome.result.ok, true);
  });

  it('não repete timeout', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const err = new Error('timeout');
      err.name = 'TimeoutError';
      throw err;
    };
    const outcome = await readWithOneRetry({
      settings,
      image: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      fetchImpl,
    });
    assert.equal(calls, 1);
    assert.equal(outcome.result.outcome, 'timeout');
  });
});
