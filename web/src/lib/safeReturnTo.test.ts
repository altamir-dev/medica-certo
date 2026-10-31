import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeReturnTo } from './safeReturnTo.ts';

describe('safeReturnTo', () => {
  it('accepts same-origin relative paths', () => {
    assert.equal(safeReturnTo('/medicamentos'), '/medicamentos');
    assert.equal(
      safeReturnTo('/pacientes/1/tratamentos/novo'),
      '/pacientes/1/tratamentos/novo',
    );
  });

  it('rejects null and empty', () => {
    assert.equal(safeReturnTo(null), null);
    assert.equal(safeReturnTo(''), null);
  });

  it('rejects protocol-relative and absolute URLs', () => {
    assert.equal(safeReturnTo('//evil.com'), null);
    assert.equal(safeReturnTo('https://evil.com'), null);
    assert.equal(safeReturnTo('http://evil.com/x'), null);
  });

  it('rejects embedded :// and non-slash prefix', () => {
    assert.equal(safeReturnTo('/foo://bar'), null);
    assert.equal(safeReturnTo('medicamentos'), null);
    assert.equal(safeReturnTo('foo/bar'), null);
  });
});
