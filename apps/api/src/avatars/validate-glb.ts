import { lstat, readFile } from 'fs/promises';
import { z } from 'zod';

// Acceptance policy for the owned static g18-1 avatar exporter, not a general glTF validator.
// Container layout/units: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
export async function validatePersonalGlb(file: string, declaredHeightCm: number) {
  const info = await lstat(file);
  if (!info.isFile() || info.size < 28 || info.size > 50 * 1024 * 1024)
    throw new Error('GLB_INVALIDO');
  const data = await readFile(file);
  const fail = (): never => {
    throw new Error('GLB_INVALIDO');
  };
  if (
    data.toString('ascii', 0, 4) !== 'glTF' ||
    data.readUInt32LE(4) !== 2 ||
    data.readUInt32LE(8) !== data.length
  )
    fail();
  const chunks: { type: number; bytes: Buffer }[] = [];
  let offset = 12;
  while (offset < data.length) {
    if (offset + 8 > data.length) fail();
    const length = data.readUInt32LE(offset),
      type = data.readUInt32LE(offset + 4);
    if (length % 4 || offset + 8 + length > data.length) fail();
    chunks.push({ type, bytes: data.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  if (chunks.length !== 2 || chunks[0].type !== 0x4e4f534a || chunks[1].type !== 0x004e4942) fail();
  let doc: any;
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chunks[0].bytes));
  } catch {
    fail();
  }
  const binary = chunks[1].bytes;
  if (
    doc?.asset?.version !== '2.0' ||
    (doc.asset.minVersion && doc.asset.minVersion !== '2.0') ||
    doc.extensionsRequired?.length ||
    doc.images?.length ||
    doc.skins?.length ||
    doc.animations?.length
  )
    fail();
  const checkUris = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uri') fail();
      checkUris(child);
    }
  };
  checkUris(doc);
  const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
  if (
    !Array.isArray(doc.buffers) ||
    doc.buffers.length !== 1 ||
    !integer(doc.buffers[0].byteLength) ||
    doc.buffers[0].byteLength > binary.length ||
    binary.length - doc.buffers[0].byteLength > 3
  )
    fail();
  if (
    !Array.isArray(doc.bufferViews) ||
    !Array.isArray(doc.accessors) ||
    !Array.isArray(doc.meshes) ||
    !Array.isArray(doc.nodes)
  )
    fail();
  for (const view of doc.bufferViews) {
    if (
      view.buffer !== 0 ||
      !integer(view.byteOffset ?? 0) ||
      !integer(view.byteLength) ||
      (view.byteOffset ?? 0) + view.byteLength > doc.buffers[0].byteLength
    )
      fail();
  }
  const componentBytes: Record<number, number> = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
  };
  const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const layout = (index: unknown) => {
    if (!integer(index)) fail();
    const accessor = doc.accessors[index as number];
    if (
      !accessor ||
      accessor.sparse ||
      !integer(accessor.bufferView) ||
      !integer(accessor.count) ||
      accessor.count === 0
    )
      fail();
    const view = doc.bufferViews[accessor.bufferView],
      size = componentBytes[accessor.componentType],
      count = components[accessor.type];
    if (!view || !size || !count || !integer(accessor.byteOffset ?? 0)) fail();
    const stride = view.byteStride ?? size * count,
      relative = accessor.byteOffset ?? 0;
    if (
      !integer(stride) ||
      stride < size * count ||
      stride % size ||
      relative % size ||
      relative + stride * (accessor.count - 1) + size * count > view.byteLength
    )
      fail();
    return { accessor, view, stride, offset: (view.byteOffset ?? 0) + relative };
  };
  for (let index = 0; index < doc.accessors.length; index++) layout(index);
  const node = doc.nodes.find((n: any) => n.name === 'Cuerpo_G18');
  if (!node || node.extras?.reference !== false || node.extras?.plantilla !== 'g18-1')
    throw new Error('AVATAR_REFERENCIAL');
  // This exporter applies transforms before export; accepting arbitrary transforms would invalidate measured height.
  if (
    doc.nodes.length !== 1 ||
    node.matrix ||
    node.translation ||
    node.rotation ||
    node.scale ||
    !integer(node.mesh)
  )
    fail();
  const mesh = doc.meshes[node.mesh];
  if (!mesh?.primitives?.length) fail();
  let minY = Infinity,
    maxY = -Infinity;
  for (const primitive of mesh.primitives) {
    if ((primitive.mode ?? 4) !== 4) fail();
    const pos = layout(primitive.attributes?.POSITION);
    if (
      pos.accessor.componentType !== 5126 ||
      pos.accessor.type !== 'VEC3' ||
      pos.accessor.normalized
    )
      fail();
    for (let i = 0; i < pos.accessor.count; i++) {
      const base = pos.offset + i * pos.stride;
      const xyz = [
        binary.readFloatLE(base),
        binary.readFloatLE(base + 4),
        binary.readFloatLE(base + 8),
      ];
      if (xyz.some((v) => !Number.isFinite(v) || Math.abs(v) > 5)) fail();
      minY = Math.min(minY, xyz[1]);
      maxY = Math.max(maxY, xyz[1]);
    }
    if (primitive.indices !== undefined) {
      const indices = layout(primitive.indices);
      if (
        indices.accessor.type !== 'SCALAR' ||
        ![5121, 5123, 5125].includes(indices.accessor.componentType) ||
        indices.accessor.count % 3
      )
        fail();
      for (let i = 0; i < indices.accessor.count; i++) {
        const at = indices.offset + i * indices.stride;
        const value =
          indices.accessor.componentType === 5121
            ? binary.readUInt8(at)
            : indices.accessor.componentType === 5123
              ? binary.readUInt16LE(at)
              : binary.readUInt32LE(at);
        if (value >= pos.accessor.count) fail();
      }
    } else if (pos.accessor.count % 3) fail();
  }
  if (
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY) ||
    Math.abs(maxY - minY - declaredHeightCm / 100) > 0.03 ||
    Math.abs(minY) > 0.05
  )
    throw new Error('ESCALA_AVATAR_INVALIDA');
  return { bytes: data.length, heightMetres: maxY - minY };
}

const measure = z
  .object({
    valor_cm: z.number().finite().positive().max(230),
    origen: z.enum(['DECLARADA', 'ESTIMADA', 'CORREGIDA']),
    confianza: z.number().min(0).max(1),
  })
  .strict();
export const AvatarMeasuresSchema = z
  .object({
    altura: measure,
    pecho: measure,
    cintura: measure,
    cadera: measure,
    largoBrazo: measure.optional(),
    largoPierna: measure.optional(),
  })
  .strict();
export const AvatarParametersSchema = z
  .object({
    height: z.number().min(1).max(2.3),
    chest_width: z.number().positive().max(1.5),
    chest_depth: z.number().positive().max(1.5),
    waist_width: z.number().positive().max(1.5),
    hip_width: z.number().positive().max(1.5),
    plantilla: z.literal('g18-1'),
  })
  .strict();
