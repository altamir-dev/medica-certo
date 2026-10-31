import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { config } from './config.mjs';
import {
  MAX_PHOTO_BYTES,
  escapeIlike,
  mapMedication,
  matchesImageMagic,
  parseMedicationBody,
  resolvePhotoAbsolutePath,
  saveMedicationPhoto,
} from './medications.mjs';

describe('escapeIlike', () => {
  it('escapes backslash, percent and underscore', () => {
    assert.equal(escapeIlike('a%b_c\\d'), 'a\\%b\\_c\\\\d');
  });

  it('leaves plain text unchanged', () => {
    assert.equal(escapeIlike('Prednisolona'), 'Prednisolona');
  });
});

describe('resolvePhotoAbsolutePath', () => {
  const root = resolve(config.dataDir, 'med-photos');

  it('resolves relative path under med-photos', () => {
    const absolute = resolvePhotoAbsolutePath(
      '11111111-1111-1111-1111-111111111111/abc.jpg',
    );
    assert.equal(
      absolute,
      resolve(root, '11111111-1111-1111-1111-111111111111/abc.jpg'),
    );
  });

  it('rejects path escape via ..', () => {
    assert.throws(() => resolvePhotoAbsolutePath('../outside.jpg'), /Invalid/);
  });

  it('rejects absolute path escape', () => {
    assert.throws(() => resolvePhotoAbsolutePath('/etc/passwd'), /Invalid/);
  });
});

describe('mapMedication', () => {
  it('maps snake_case row to camelCase and hasPhoto', () => {
    const mapped = mapMedication({
      id: 'id-1',
      name: 'Amoxilina',
      active_ingredient: 'amoxicilina',
      indication: null,
      reference_posology: null,
      usual_interval_hours: 8,
      photo_path: 'c/u.jpg',
      created_at: new Date('2026-01-02T03:04:05.000Z'),
      updated_at: '2026-01-03T04:05:06.000Z',
    });

    assert.deepEqual(mapped, {
      id: 'id-1',
      name: 'Amoxilina',
      activeIngredient: 'amoxicilina',
      indication: '',
      referencePosology: '',
      usualIntervalHours: 8,
      concentration: '',
      presentation: '',
      anvisaRegistry: '',
      catalogOrigin: 'manual',
      hasPhoto: true,
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-01-03T04:05:06.000Z',
    });
  });

  it('sets hasPhoto false and null interval when absent', () => {
    const mapped = mapMedication({
      id: 'id-2',
      name: 'X',
      active_ingredient: null,
      indication: null,
      reference_posology: null,
      usual_interval_hours: null,
      photo_path: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(mapped.hasPhoto, false);
    assert.equal(mapped.usualIntervalHours, null);
  });
});

describe('parseMedicationBody', () => {
  const intervalMsg = 'Informe um intervalo em horas entre 1 e 168.';

  it('accepts valid payload with optional fields', () => {
    const parsed = parseMedicationBody({
      name: '  Prednisolona ',
      activeIngredient: 'pred',
      indication: 'asma',
      referencePosology: '1 cp',
      usualIntervalHours: 8,
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.value, {
        name: 'Prednisolona',
        activeIngredient: 'pred',
        indication: 'asma',
        referencePosology: '1 cp',
        usualIntervalHours: 8,
        concentration: '',
        presentation: '',
        anvisaRegistry: '',
        catalogOrigin: 'manual',
      });
    }
  });

  it('accepts interval as numeric string and boundaries 1/168', () => {
    const asString = parseMedicationBody({
      name: 'A',
      usualIntervalHours: '8',
    });
    assert.equal(asString.ok, true);
    if (asString.ok) assert.equal(asString.value.usualIntervalHours, 8);

    const min = parseMedicationBody({ name: 'A', usualIntervalHours: 1 });
    const max = parseMedicationBody({ name: 'A', usualIntervalHours: 168 });
    assert.equal(min.ok, true);
    assert.equal(max.ok, true);
    if (min.ok) assert.equal(min.value.usualIntervalHours, 1);
    if (max.ok) assert.equal(max.value.usualIntervalHours, 168);
  });

  it('rejects blank name', () => {
    const parsed = parseMedicationBody({ name: '   ' });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.fields.name, 'Informe o nome.');
    }
  });

  it('rejects name longer than 120', () => {
    const parsed = parseMedicationBody({ name: 'x'.repeat(121) });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.equal(parsed.fields.name, 'Nome muito longo.');
    }
  });

  it('rejects interval outside 1–168 and non-integers', () => {
    const low = parseMedicationBody({ name: 'A', usualIntervalHours: 0 });
    const high = parseMedicationBody({ name: 'A', usualIntervalHours: 169 });
    const frac = parseMedicationBody({ name: 'A', usualIntervalHours: 1.5 });
    assert.equal(low.ok, false);
    assert.equal(high.ok, false);
    assert.equal(frac.ok, false);
    if (!low.ok) assert.equal(low.fields.usualIntervalHours, intervalMsg);
    if (!high.ok) assert.equal(high.fields.usualIntervalHours, intervalMsg);
    if (!frac.ok) assert.equal(frac.fields.usualIntervalHours, intervalMsg);
  });

  it('treats empty interval as null', () => {
    const parsed = parseMedicationBody({ name: 'A', usualIntervalHours: '' });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.value.usualIntervalHours, null);
  });
});

describe('matchesImageMagic', () => {
  it('accepts JPEG / PNG / WebP signatures', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    const webp = Buffer.from('RIFF....WEBP');
    assert.equal(matchesImageMagic(jpeg, 'image/jpeg'), true);
    assert.equal(matchesImageMagic(png, 'image/png'), true);
    assert.equal(matchesImageMagic(webp, 'image/webp'), true);
  });

  it('rejects spoofed mime with wrong bytes', () => {
    const fake = Buffer.from('not an image!!');
    assert.equal(matchesImageMagic(fake, 'image/png'), false);
  });
});

describe('saveMedicationPhoto early validation', () => {
  it('rejects unsupported mime without hitting the database', async () => {
    const result = await saveMedicationPhoto('caregiver', 'med', {
      buffer: Buffer.from('GIF89a'),
      mimetype: 'image/gif',
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'VALIDATION');
      assert.match(result.message ?? '', /JPEG|PNG|WebP/i);
    }
  });

  it('rejects empty buffer', async () => {
    const result = await saveMedicationPhoto('caregiver', 'med', {
      buffer: Buffer.alloc(0),
      mimetype: 'image/png',
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'VALIDATION');
      assert.match(result.message ?? '', /vazio/i);
    }
  });

  it('rejects oversize buffer', async () => {
    const result = await saveMedicationPhoto('caregiver', 'med', {
      buffer: Buffer.alloc(MAX_PHOTO_BYTES + 1),
      mimetype: 'image/jpeg',
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'VALIDATION');
      assert.match(result.message ?? '', /2 MB/i);
    }
  });

  it('rejects mime/magic mismatch', async () => {
    const result = await saveMedicationPhoto('caregiver', 'med', {
      buffer: Buffer.from('not-a-real-png!!!!!!!'),
      mimetype: 'image/png',
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'VALIDATION');
      assert.match(result.message ?? '', /não corresponde/i);
    }
  });
});
