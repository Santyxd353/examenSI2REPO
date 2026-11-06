import 'dotenv/config';
import { execFile } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { promisify } from 'util';
import {
  fileHash,
  inspectGarmentGlb,
  inspectImage,
} from '../apps/api/src/offline/resource-integrity';

const source = resolve('catalog-assets/women');
const sizes = ['S', 'M', 'L'] as const;
export async function prepareOfflineResources(
  storageRoot: string,
  modelSource = resolve(source, 'glb'),
) {
  const entries: { code: string; imageFile: string }[] = JSON.parse(
    await readFile(resolve(source, 'catalog.json'), 'utf8'),
  );
  for (const item of entries) {
    const pngName = item.imageFile.replace(/\.(?:jpe?g|webp)$/i, '.png');
    try {
      await inspectImage(await readFile(resolve(source, 'ar', pngName)), 'image/png', true);
    } catch {
      throw new Error('El PNG de ' + item.code + ' no es apto para la descarga AR.');
    }
  }
  const models = new Map<
    string,
    { key: string; bytes: number; triangles: number; sha256: string }
  >();
  await mkdir(resolve(storageRoot, 'public/catalog-3d'), { recursive: true });
  for (const kind of ['dress', 'skirt'])
    for (const size of sizes) {
      const name = kind + '-' + size,
        bytes = await readFile(resolve(modelSource, name + '.glb'));
      const { triangles } = await inspectGarmentGlb(bytes);
      const sha256 = fileHash(bytes),
        key = 'public/catalog-3d/' + name + '-' + sha256 + '.glb';
      await writeFile(resolve(storageRoot, key), bytes, { flag: 'wx' }).catch(
        async (error: NodeJS.ErrnoException) => {
          if (
            error.code !== 'EEXIST' ||
            fileHash(await readFile(resolve(storageRoot, key))) !== sha256
          )
            throw error;
        },
      );
      models.set(name, { key, bytes: bytes.length, triangles, sha256 });
    }
  return models;
}
async function main() {
  const storage = resolve(process.env.STORAGE_ROOT || '.local/storage');
  let from: string | undefined;
  if (process.argv.includes('--regenerate')) {
    from = resolve('.local/offline-model-build');
    await mkdir(from, { recursive: true });
    await promisify(execFile)(
      process.env.PYTHON_PATH || 'workers/avatar/.venv/Scripts/python.exe',
      [resolve('workers/avatar/process.py'), '--demo', from],
      { env: { ...process.env }, windowsHide: true, timeout: 180000 },
    );
  }
  const models = await prepareOfflineResources(storage, from);
  console.log('6 siluetas GLB verificadas por talla y 12 PNG AR validados. Archivos en ' + storage);
  for (const [name, model] of models) console.log(name, model.triangles, model.bytes, model.sha256);
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
