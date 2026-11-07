// Local acceptance only: DB fixture avatar rendered from a real export; does not certify photo inference/B14.
require('dotenv/config');
const { chromium, expect } = require('@playwright/test');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');
const { randomUUID } = require('crypto');
const { mkdir, readFile } = require('fs/promises');
const { resolve } = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/vestidor18_test';
  for (const key of ['DATABASE_URL', 'PLATFORM_DATABASE_URL', 'TENANT_DATABASE_URL'])
    process.env[key] = url.toString();
  process.env.SERVE_WEB = 'true';
  process.env.WEB_ROOT = resolve('dist/web');
  const port = 3023,
    origin = `http://127.0.0.1:${port}`;
  process.env.WEB_ORIGIN = origin;
  const { createApp } = require('../dist/api/app');
  const { storedPath } = require('../dist/api/storage');
  const app = await createApp();
  await app.listen(port, '127.0.0.1');
  const db = new PrismaClient(),
    browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text());
  });
  try {
    const email = `fitting-${randomUUID()}@qa.test`,
      password = 'PruebaVestidor2026!';
    const role = await db.rol.findUniqueOrThrow({ where: { nombre: 'Cliente' } });
    const owner = await db.usuario.create({
      data: {
        nombres: 'Ana',
        apellidos: 'Vestidor QA',
        correo: email,
        clave_hash: await hash(password, 12),
        estado: 'ACTIVO',
        preferencias: {},
        creado_en: new Date(),
        usuario_rol: { create: { rol_id: role.id, asignado_en: new Date() } },
      },
    });
    await page.goto(origin);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Iniciar sesión', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Mi avatar', exact: true }).click();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    );
    for (const view of ['frente', 'perfil', 'espalda'])
      await page
        .locator(`input[name="${view}"]`)
        .setInputFiles({ name: `${view}.png`, mimeType: 'image/png', buffer: png });
    await page.locator('input[name="altura"]').fill('170');
    await page.locator('input[name="adulto"]').check();
    await page.locator('input[name="consentimiento"]').check();
    let calls = 0;
    await page.route('**/api/avatars', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      calls++;
      const result = await route.fetch();
      if (calls === 1) {
        expect(result.status()).toBe(201);
        await route.abort('failed');
      } else {
        expect(result.status()).toBe(201);
        await route.fulfill({ response: result });
      }
    });
    const submit = page.getByRole('button', { name: 'Generar mi avatar', exact: true });
    await submit.click();
    await expect(submit).toBeEnabled();
    expect(await db.trabajo_avatar.count({ where: { usuario_id: owner.id } })).toBe(1);
    await submit.click();
    await expect(
      page.getByText('Fotos recibidas. Puedes consultar el progreso aquí.', { exact: true }),
    ).toBeVisible();
    expect(await db.trabajo_avatar.count({ where: { usuario_id: owner.id } })).toBe(1);
    expect(
      await db.consumo_cuota.count({ where: { actor_id: owner.id, estado: 'RESERVADO' } }),
    ).toBe(1);
    await page.unroute('**/api/avatars');

    const key = `private/fixtures/${randomUUID()}`,
      folder = storedPath(key);
    await mkdir(folder, { recursive: true });
    const parameters = {
      height: 1.7,
      chest_width: 0.4,
      chest_depth: 0.25,
      waist_width: 0.32,
      hip_width: 0.4,
      plantilla: 'g18-1',
    };
    await promisify(execFile)(
      resolve(process.env.PYTHON_PATH),
      [
        '-c',
        'import sys,json;from pathlib import Path;from process import export;export(json.loads(sys.argv[1]),Path(sys.argv[2]))',
        JSON.stringify(parameters),
        folder,
      ],
      {
        cwd: resolve('workers/avatar'),
        env: { ...process.env },
        windowsHide: true,
        timeout: 120000,
      },
    );
    const template = await db.plantilla_corporal.findFirstOrThrow();
    const avatar = await db.avatar.create({
      data: {
        usuario_id: owner.id,
        plantilla_id: template.id,
        version: 1,
        estado: 'EN_REVISION',
        clave_glb: `${key}/avatar.glb`,
        medidas: { altura: { valor_cm: 170 } },
        parametros_malla: parameters,
        creado_en: new Date(),
      },
    });
    await expect(page.getByRole('button', { name: /Versión 1 EN REVISION/ })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole('button', { name: /Versión 1 EN REVISION/ }).click();
    await expect(page.locator('.avatar-sidebar canvas')).toBeVisible();
    await expect(page.locator('.avatar-sidebar .viewer-status')).toHaveCount(0, { timeout: 15000 });
    await page.getByRole('button', { name: 'Aprobar este avatar', exact: true }).click();
    await expect
      .poll(async () => (await db.avatar.findUniqueOrThrow({ where: { id: avatar.id } })).estado)
      .toBe('APROBADO');
    // Explicit M/Negro fixture, independent of whichever demonstration catalog is installed.
    const source = await db.modelo_prenda.findFirstOrThrow({
      where: { estado: 'PUBLICADO' },
      include: { variante: { include: { producto: true } } },
    });
    await promisify(execFile)(
      resolve(process.env.PYTHON_PATH),
      [resolve('workers/avatar/process.py'), '--demo', resolve(folder, 'garments')],
      { env: { ...process.env }, windowsHide: true, timeout: 120000 },
    );
    const garmentKey = `${key}/garments/dress-M.glb`;
    const garmentData = await readFile(storedPath(garmentKey)),
      garmentBytes = garmentData.length;
    const gltf = JSON.parse(garmentData.subarray(20, 20 + garmentData.readUInt32LE(12)).toString());
    const triangles = gltf.meshes.reduce(
      (sum, mesh) =>
        sum +
        mesh.primitives.reduce(
          (n, p) => n + gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3,
          0,
        ),
      0,
    );
    const product = await db.producto.create({
      data: {
        categoria_id: source.variante.producto.categoria_id,
        nombre: `Vestido negro QA ${randomUUID().slice(0, 8)}`,
        descripcion: 'Prenda de prueba local',
        material: 'Algodón',
        marca: 'QA',
        estado: 'PUBLICADO',
        creado_en: new Date(),
      },
    });
    const location = await db.ubicacion.findFirstOrThrow({ where: { activa: true } });
    let garment;
    for (const talla of ['S', 'M']) {
      const variant = await db.variante.create({
        data: {
          producto_id: product.id,
          sku: randomUUID(),
          talla,
          color: 'Negro',
          color_hex: '#111111',
          activa: true,
        },
      });
      await db.inventario.create({
        data: {
          variante_id: variant.id,
          ubicacion_id: location.id,
          fisico: 10,
          reservado: 0,
          comprometido: 0,
          version: 1,
        },
      });
      for (const canal of ['WEB', 'APP', 'TIENDA']) {
        await db.precio_canal.create({
          data: {
            variante_id: variant.id,
            canal,
            moneda: 'BOB',
            importe: 50,
            descuento_pct: 0,
            desde: new Date(),
          },
        });
        await db.disponibilidad_canal.create({
          data: {
            variante_id: variant.id,
            ubicacion_id: location.id,
            canal,
            habilitada: true,
            stock_seguridad: 0,
            plazo_reposicion_dias: 0,
          },
        });
      }
      const model = await db.modelo_prenda.create({
        data: {
          variante_id: variant.id,
          plantilla_id: template.id,
          version: 1,
          clave_glb: garmentKey,
          ajuste: { template: 'g18-1', reference: true },
          bytes: garmentBytes,
          triangulos: triangles,
          licencia: 'Geometría propia Grupo 18, fixture de vista aproximada',
          estado: 'PUBLICADO',
          creado_en: new Date(),
        },
      });
      if (talla === 'M') garment = { ...model, variante: { ...variant, producto: product } };
    }
    await page.reload();
    await expect(page.getByRole('button', { name: 'Mi carrito', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Colección', exact: true }).click();
    await page.locator('.search input').fill(product.nombre);
    const card = page
      .locator('article.product')
      .filter({
        has: page.getByRole('heading', { name: garment.variante.producto.nombre, exact: true }),
      });
    await card
      .getByRole('button', { name: `${garment.variante.producto.nombre} talla M`, exact: true })
      .click();
    await card.getByRole('button', { name: 'Probar en 3D', exact: true }).click();
    await expect(
      page.getByText('Prenda cargada sobre tu avatar. La vista es aproximada.', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.viewer-status')).toHaveCount(0, { timeout: 15000 });
    await page.getByRole('button', { name: 'Acercar modelo', exact: true }).click();
    await page.getByRole('button', { name: 'Restablecer cámara', exact: true }).click();
    const canvas = page.locator('canvas');
    const bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2, {
      steps: 10,
    });
    await page.mouse.up();
    await card.getByRole('button', { name: 'Agregar al carrito', exact: true }).click();
    await expect(page.getByText('Prenda agregada al carrito.', { exact: true })).toBeVisible();
    const items = await db.item_carrito.findMany({ where: { carrito: { usuario_id: owner.id } } });
    expect(items).toHaveLength(1);
    expect(items[0].variante_id).toBe(garment.variante_id);
    await page.screenshot({ path: '.local/fitting-web.png', fullPage: true });
    expect(errors).toEqual([]);
    console.log(
      JSON.stringify({
        ok: true,
        lostResponse: true,
        exactVariant: { size: garment.variante.talla, color: garment.variante.color },
        render: true,
        errors,
      }),
    );
  } finally {
    await browser.close();
    await db.$disconnect();
    await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
