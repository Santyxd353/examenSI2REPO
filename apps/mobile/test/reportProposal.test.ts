import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateMobileProposal } from '../src/modules/reports/reportProposal';
const fixture = JSON.parse(
  readFileSync('../../packages/contracts/fixtures/report-golden-v1.json', 'utf8'),
);
test('la propuesta es una definición revisable y rechaza cambio de conjunto o fuente', () => {
  const suggestion = { explanation: 'Ventas por canal', definition: fixture.definition };
  assert.deepEqual(validateMobileProposal(suggestion, fixture.dataset), suggestion);
  assert.throws(() =>
    validateMobileProposal(
      { ...suggestion, definition: { ...fixture.definition, source: 'REAL' } },
      fixture.dataset,
    ),
  );
  assert.throws(() =>
    validateMobileProposal(
      { ...suggestion, definition: { ...fixture.definition, datasetId: 'otro' } },
      fixture.dataset,
    ),
  );
});
