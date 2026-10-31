/**
 * Demo flow + screenshots for medica-certo README.
 * Usage: node scripts/demo-screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.MC_BASE_URL ?? 'http://127.0.0.1:5179';
const OUT = path.resolve(process.env.MC_SHOTS_DIR ?? path.join(ROOT, 'docs/screenshots'));

const ACCOUNT = {
  name: 'Ana Cuidadora',
  email: 'demo@medica.test',
  password: 'demo12345',
};

const MEDS = [
  {
    name: 'Dipirona 500 mg',
    activeIngredient: 'Metamizol sódico',
    indication: 'Dor e febre',
    referencePosology: '1 comprimido',
    usualIntervalHours: '6',
  },
  {
    name: 'Losartana 50 mg',
    activeIngredient: 'Losartana potássica',
    indication: 'Hipertensão',
    referencePosology: '1 comprimido',
    usualIntervalHours: '24',
  },
  {
    name: 'Omeprazol 20 mg',
    activeIngredient: 'Omeprazol',
    indication: 'Proteção gástrica',
    referencePosology: '1 cápsula em jejum',
    usualIntervalHours: '24',
  },
];

const PATIENTS = [
  { name: 'Maria Silva', birthDate: '1948-03-12' },
  { name: 'João Pereira', birthDate: '1955-07-22' },
];

function fillByLabel(page, labelText, value) {
  return page
    .locator('label')
    .filter({ hasText: labelText })
    .locator('input, textarea, select')
    .first()
    .fill(value);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('shot', file);
  return file;
}

async function dismissAlarms(page) {
  const banner = page.locator('.alarm-banner');
  if (await banner.count()) {
    const silence = banner.getByRole('button', { name: 'Silenciar' });
    if (await silence.count()) {
      await silence.click({ force: true }).catch(() => {});
    }
    // Skip remaining active alarms so the banner goes away
    for (let i = 0; i < 8; i++) {
      if (!(await banner.isVisible().catch(() => false))) break;
      const skip = banner.getByRole('button', { name: 'Pular' }).first();
      if (await skip.count()) {
        await skip.click({ force: true });
        await page.waitForTimeout(400);
      } else {
        break;
      }
    }
  }
}

async function ensureLoggedIn(page) {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('input[type="email"]');

  // Prefer login — "Criar cuidador" stays visible until a failed register
  // flips bootstrapClosed, even when a caregiver already exists.
  await page.locator('input[type="email"]').fill(ACCOUNT.email);
  await page.locator('input[type="password"]').fill(ACCOUNT.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForTimeout(1000);

  if (page.url().includes('/login')) {
    const alert = await page.locator('[role=alert]').textContent().catch(() => '');
    console.log('login failed, trying register:', alert);
    const createBtn = page.getByRole('button', {
      name: /Primeiro acesso\? Criar cuidador/i,
    });
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      await page.waitForSelector('input[autocomplete="name"]');
      await page.locator('input[autocomplete="name"]').fill(ACCOUNT.name);
      await page.locator('input[type="email"]').fill(ACCOUNT.email);
      await page.locator('input[type="password"]').fill(ACCOUNT.password);
      await shot(page, '01-criar-cuidador');
      await page.getByRole('button', { name: 'Criar cuidador' }).click();
    }
  } else if (!(await import('node:fs/promises').then((fs) =>
    fs.access(`${OUT}/01-criar-cuidador.png`).then(() => true, () => false),
  ))) {
    await shot(page, '01-criar-cuidador');
  }

  await page.waitForURL((url) => !url.pathname.includes('/login'));
  await page.waitForSelector('text=Dashboard');
}

async function createMedication(page, med) {
  await dismissAlarms(page);
  await page.goto(`${BASE}/medicamentos/novo`);
  await page.waitForSelector('text=Novo medicamento');
  await page.locator('.patients-field', { hasText: 'Nome' }).locator('input').fill(med.name);
  await page.locator('.patients-field', { hasText: 'Princípio ativo' }).locator('input').fill(med.activeIngredient);
  await page.locator('.patients-field', { hasText: 'Indicação' }).locator('input').fill(med.indication);
  await page.locator('.patients-field', { hasText: 'Posologia de referência' }).locator('textarea').fill(med.referencePosology);
  await page.locator('.patients-field', { hasText: 'Intervalo usual' }).locator('input').fill(med.usualIntervalHours);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await Promise.race([
    page.waitForURL(/\/medicamentos(\?|$)/),
    page.waitForSelector('[role=alert], .meds-duplicate', { timeout: 25000 }),
  ]);
  if (page.url().includes('/medicamentos/novo') || /\/medicamentos\/[^/?]+/.test(page.url())) {
    console.log('medication create stayed on form (maybe duplicate):', med.name, page.url());
    await page.goto(`${BASE}/medicamentos`);
  }
}

async function createPatient(page, patient) {
  await dismissAlarms(page);
  await page.goto(`${BASE}/pacientes/novo`);
  await page.waitForSelector('text=Novo paciente');
  await fillByLabel(page, 'Nome', patient.name);
  await fillByLabel(page, 'Data de nascimento', patient.birthDate);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.waitForURL(/\/pacientes(\?|$)/);
}

function toDatetimeLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function addTreatment(page, patientName, medicationName, opts = {}) {
  await dismissAlarms(page);
  await page.goto(`${BASE}/pacientes`);
  await page.getByRole('link', { name: patientName }).click();
  await page.waitForURL(/\/pacientes\/[^/]+$/);
  await dismissAlarms(page);
  await page
    .getByRole('link', { name: /Adicionar medicamento/i })
    .first()
    .click();
  await page.waitForURL(/tratamentos\/novo/);

  await page.locator('#med-search').fill(medicationName);
  await page
    .locator('.treatments-med-results button')
    .filter({ hasText: medicationName })
    .first()
    .click();
  await page.locator('#dose-qty').fill(opts.doseQuantity ?? '1 comprimido');

  if (opts.intervalHours) {
    await page.locator('#interval').fill(String(opts.intervalHours));
  }

  const start = new Date();
  start.setHours(start.getHours() - (opts.hoursAgo ?? 4), 0, 0, 0);
  await page.locator('#starts-at').fill(toDatetimeLocal(start));

  const end = new Date();
  end.setDate(end.getDate() + (opts.daysAhead ?? 2));
  await page.locator('#ends-on').fill(end.toISOString().slice(0, 10));

  // Avoid alarm banner intercepting clicks during the demo
  const alarms = page.locator('label.treatments-check input[type="checkbox"]');
  if (await alarms.isChecked()) {
    await alarms.uncheck();
  }

  await dismissAlarms(page);
  await page.getByRole('button', { name: 'Salvar tratamento' }).click({ force: true });
  await page.waitForURL(/\/tratamentos\/[^/]+\/grade/, { timeout: 30000 });
  return page.url();
}

async function patientHasTreatment(page, patientName, medicationName) {
  await dismissAlarms(page);
  await page.goto(`${BASE}/pacientes`);
  await page.getByRole('link', { name: patientName }).click();
  await page.waitForURL(/\/pacientes\/[^/]+$/);
  return page.locator('.treatments-row').filter({ hasText: medicationName }).count().then((n) => n > 0);
}

async function markAdministeredOnPatientSheet(page, patientName, count = 2) {
  await dismissAlarms(page);
  await page.goto(`${BASE}/pacientes`);
  await page.getByRole('link', { name: patientName }).click();
  await page.waitForURL(/\/pacientes\/[^/]+$/);
  await page.waitForSelector('.cal-subcell--med');

  for (let i = 0; i < count; i++) {
    await dismissAlarms(page);
    // Prefer overdue chips so CONFIRM_EARLY is not required
    let target = page.locator(
      'button.cal-subcell--med.cal-subcell--overdue:not(.cal-subcell--filled)',
    );
    if ((await target.count()) === 0) {
      target = page.locator(
        'button.cal-subcell--med:not(.cal-subcell--filled)',
      );
    }
    if ((await target.count()) === 0) {
      console.log('no pending chips left for', patientName);
      break;
    }
    await target.first().click({ force: true });
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible' });

    // If register form asks for early confirm, check it
    for (let attempt = 0; attempt < 3; attempt++) {
      const early = dialog.locator(
        'label.sheet-modal__check input[type="checkbox"]',
      );
      if (await early.count()) {
        await early.check({ force: true });
      }
      const alert = await dialog.locator('[role=alert]').textContent().catch(() => null);
      if (alert) console.log('modal alert:', alert);

      await dialog.getByRole('button', { name: 'Salvar' }).click({ force: true });
      try {
        await dialog.waitFor({ state: 'hidden', timeout: 5000 });
        break;
      } catch {
        // stay and retry (often CONFIRM_EARLY_REQUIRED)
        if (attempt === 2) {
          await page.screenshot({
            path: `/tmp/modal-fail-${patientName.replace(/\s+/g, '-')}.png`,
            fullPage: true,
          });
          // Close and continue rather than hard-fail the whole demo
          const cancel = dialog.getByRole('button', { name: /Cancelar|Fechar/ });
          if (await cancel.count()) await cancel.click({ force: true });
          else await page.keyboard.press('Escape');
        }
      }
    }
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  await ensureLoggedIn(page);
  await dismissAlarms(page);
  await shot(page, '02-dashboard-vazio');

  // Medications (skip if already present)
  await page.goto(`${BASE}/medicamentos`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const hasDipirona = (await page.getByText('Dipirona 500 mg').count()) > 0;
  if (!hasDipirona) {
    await shot(page, '03-medicamentos-vazio');
    for (const med of MEDS) {
      await createMedication(page, med);
    }
  } else {
    // Keep an empty-state shot only if we already captured one earlier
    console.log('medications already seeded');
  }
  await page.goto(`${BASE}/medicamentos`);
  await page.waitForSelector('text=Dipirona 500 mg');
  await shot(page, '04-medicamentos-lista');

  // Patients
  await page.goto(`${BASE}/pacientes`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const hasMaria = (await page.getByText('Maria Silva').count()) > 0;
  if (!hasMaria) {
    for (const p of PATIENTS) {
      await createPatient(page, p);
    }
  } else {
    console.log('patients already seeded');
  }
  await page.goto(`${BASE}/pacientes`);
  await page.waitForSelector('text=Maria Silva');
  await shot(page, '05-pacientes-lista');

  // Treatments
  let gradeUrlMaria;
  if (!(await patientHasTreatment(page, 'Maria Silva', 'Dipirona 500 mg'))) {
    gradeUrlMaria = await addTreatment(page, 'Maria Silva', 'Dipirona 500 mg', {
      intervalHours: 6,
      hoursAgo: 8,
      daysAhead: 1,
    });
  } else {
    await page.goto(`${BASE}/pacientes`);
    await page.getByRole('link', { name: 'Maria Silva' }).click();
    await page
      .locator('.treatments-row')
      .filter({ hasText: 'Dipirona' })
      .getByRole('link', { name: 'Detalhe' })
      .click();
    await page.waitForURL(/\/tratamentos\/[^/]+$/);
    const detailUrl = page.url();
    const treatmentId = detailUrl.split('/').filter(Boolean).pop();
    await page.getByRole('link', { name: 'Ver grade' }).click().catch(async () => {
      await page.goto(`${BASE}/tratamentos/${treatmentId}/grade`);
    });
    await page.waitForURL(/\/grade/);
    gradeUrlMaria = page.url();
  }
  await dismissAlarms(page);
  await shot(page, '06-grade-maria-dipirona');

  if (!(await patientHasTreatment(page, 'Maria Silva', 'Losartana 50 mg'))) {
    await addTreatment(page, 'Maria Silva', 'Losartana 50 mg', {
      intervalHours: 24,
      hoursAgo: 2,
      daysAhead: 2,
    });
  }

  if (!(await patientHasTreatment(page, 'João Pereira', 'Omeprazol 20 mg'))) {
    await addTreatment(page, 'João Pereira', 'Omeprazol 20 mg', {
      intervalHours: 24,
      hoursAgo: 5,
      daysAhead: 2,
    });
  }
  await dismissAlarms(page);
  await shot(page, '07-grade-joao-omeprazol');

  await page.goto(`${BASE}/pacientes`);
  await page.getByRole('link', { name: 'Maria Silva' }).click();
  await page.waitForSelector('text=Tratamentos');
  await dismissAlarms(page);
  await shot(page, '08-folha-maria');

  await markAdministeredOnPatientSheet(page, 'Maria Silva', 2);
  await dismissAlarms(page);
  await page.reload();
  await page.waitForSelector('.cal-subcell--med');
  await dismissAlarms(page);
  await shot(page, '09-folha-maria-ministradas');

  await markAdministeredOnPatientSheet(page, 'João Pereira', 1);
  await dismissAlarms(page);
  await page.reload();
  await page.waitForSelector('.cal-subcell--med');
  await dismissAlarms(page);
  await shot(page, '10-folha-joao-ministradas');

  await page.goto(`${BASE}/`);
  await page.waitForSelector('text=Dashboard');
  await dismissAlarms(page);
  await page.waitForTimeout(800);
  await shot(page, '11-dashboard');

  await page.goto(gradeUrlMaria);
  await page.waitForSelector('.treatments-grade-table');
  await dismissAlarms(page);
  await shot(page, '12-grade-com-status');

  await browser.close();
  console.log('DONE', OUT);
  console.log(`LOGIN ${ACCOUNT.email} / ${ACCOUNT.password}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
