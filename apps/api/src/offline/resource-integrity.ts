import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { ResourceReferenceSchema } from '@lumina/contracts';
import { z } from 'zod';
// Official Khronos validator, compiled to JS. Its package does not ship TypeScript declarations.
const validator: {
  validateBytes(
    bytes: Uint8Array,
    options: object,
  ): Promise<{ issues: { numErrors: number; messages: { code: string }[] } }>;
} = require('gltf-validator');
export const fileHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export type ResourceReference = z.infer<typeof ResourceReferenceSchema>;
export const invalidResource = (message: string) =>
  new BadRequestException({ code: 'INVALID_RESOURCE', message });
const signatures = {
  png: (bytes: Buffer) =>
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  jpeg: (bytes: Buffer) => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
  webp: (bytes: Buffer) =>
    bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
};
export async function inspectImage(bytes: Buffer, mime: string, ar = false) {
  const expected = ({ 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' } as const)[
    mime as 'image/png' | 'image/jpeg' | 'image/webp'
  ];
  try {
    if (!expected || bytes.length > (ar ? 5 : 10) * 1024 * 1024 || !signatures[expected](bytes))
      throw new Error();
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: ar ? 2048 ** 2 : 4096 ** 2 });
    const meta = await image.metadata();
    if (
      meta.format !== expected ||
      !meta.width ||
      !meta.height ||
      (meta.pages ?? 1) !== 1 ||
      meta.width > (ar ? 2048 : 4096) ||
      meta.height > (ar ? 2048 : 4096)
    )
      throw new Error();
    const decoded = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (ar) {
      if (mime !== 'image/png' || meta.width < 256 || meta.height < 256 || !meta.hasAlpha)
        throw new Error();
      let clear = 0,
        visible = 0;
      for (
        let at = decoded.info.channels - 1;
        at < decoded.data.length;
        at += decoded.info.channels
      ) {
        if (decoded.data[at] <= 16) clear++;
        if (decoded.data[at] >= 128) visible++;
      }
      if (Math.min(clear, visible) < meta.width * meta.height * 0.05) throw new Error();
    }
    return { width: meta.width, height: meta.height };
  } catch {
    throw invalidResource(
      ar
        ? 'AR requiere un PNG completo, de 256 a 2048 píxeles por lado y hasta 5 MiB, con prenda visible y fondo transparente.'
        : 'Imagen dañada o incompatible: usa JPEG, PNG o WebP estático, hasta 10 MiB y 4096 píxeles por lado.',
    );
  }
}
export async function inspectGarmentGlb(bytes: Buffer) {
  try {
    if (
      bytes.length < 28 ||
      bytes.length > 50 * 1024 * 1024 ||
      bytes.toString('ascii', 0, 4) !== 'glTF' ||
      bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length ||
      bytes.readUInt32LE(16) !== 0x4e4f534a
    )
      throw new Error();
    const jsonLength = bytes.readUInt32LE(12),
      binaryAt = 20 + jsonLength;
    if (
      jsonLength > 2 * 1024 * 1024 ||
      jsonLength % 4 ||
      binaryAt + 8 > bytes.length ||
      bytes.readUInt32LE(binaryAt + 4) !== 0x004e4942 ||
      binaryAt + 8 + bytes.readUInt32LE(binaryAt) !== bytes.length
    )
      throw new Error();
    const doc = JSON.parse(bytes.toString('utf8', 20, binaryAt));
    if (
      doc.asset?.version !== '2.0' ||
      doc.buffers?.length !== 1 ||
      doc.buffers[0].uri ||
      doc.animations?.length ||
      doc.skins?.length ||
      doc.extensionsRequired?.length ||
      !doc.nodes?.length ||
      !doc.meshes?.length ||
      doc.nodes.length > 100 ||
      doc.meshes.length > 100 ||
      (doc.images?.length ?? 0) > 10
    )
      throw new Error();
    for (const node of doc.nodes) {
      if (
        node.name === 'Cuerpo_G18' ||
        node.extras?.reference !== undefined ||
        (node.mesh !== undefined && node.extras?.plantilla !== 'g18-1')
      )
        throw new Error();
      if (
        node.translation?.some((n: number) => !Number.isFinite(n) || Math.abs(n) > 3) ||
        node.scale?.some(
          (n: number) => !Number.isFinite(n) || Math.abs(n) < 0.01 || Math.abs(n) > 3,
        )
      )
        throw new Error();
    }
    for (const image of doc.images ?? [])
      if (image.uri || !Number.isInteger(image.bufferView)) throw new Error();
    const result = await validator.validateBytes(new Uint8Array(bytes), {
      format: 'glb',
      maxIssues: 100,
      externalResourceFunction: () => Promise.reject(new Error('No external resources')),
    });
    if (
      result.issues.numErrors ||
      result.issues.messages.some((m) => m.code === 'UNSUPPORTED_EXTENSION')
    )
      throw new Error();
    let triangles = 0;
    for (const mesh of doc.meshes)
      for (const primitive of mesh.primitives) {
        if ((primitive.mode ?? 4) !== 4 || primitive.targets?.length || primitive.extensions)
          throw new Error();
        const position = doc.accessors[primitive.attributes.POSITION];
        if (
          position.componentType !== 5126 ||
          position.type !== 'VEC3' ||
          !position.min ||
          !position.max ||
          [...position.min, ...position.max].some(
            (n: number) => !Number.isFinite(n) || Math.abs(n) > 5,
          )
        )
          throw new Error();
        triangles +=
          (primitive.indices === undefined
            ? position.count
            : doc.accessors[primitive.indices].count) / 3;
      }
    if (!Number.isInteger(triangles) || triangles < 1 || triangles > 100000) throw new Error();
    for (const image of doc.images ?? []) {
      const view = doc.bufferViews[image.bufferView],
        start = binaryAt + 8 + (view.byteOffset ?? 0);
      await inspectImage(bytes.subarray(start, start + view.byteLength), image.mimeType);
    }
    return { triangles, template: 'g18-1' as const };
  } catch {
    throw invalidResource(
      'Modelo GLB inválido: requiere geometría estática g18-1, hasta 100000 triángulos, escala en metros y recursos embebidos.',
    );
  }
}
export async function verifyResource(bytes: Buffer, ref: ResourceReference) {
  if (bytes.length !== ref.bytes || fileHash(bytes) !== ref.sha256)
    throw invalidResource('El tamaño o SHA-256 no coincide con la referencia.');
  if (ref.usage === 'WEB_3D') {
    if (!ref.variantId || ref.mime !== 'model/gltf-binary' || ref.placement)
      throw invalidResource('El GLB requiere variante y formato WEB_3D.');
    return inspectGarmentGlb(bytes);
  }
  if (ref.usage === 'ANDROID_AR' && (!ref.variantId || !ref.placement))
    throw invalidResource('Indica la variante y colocación corporal del PNG.');
  if (ref.usage === 'GALLERY' && ref.placement)
    throw invalidResource('La galería no usa colocación corporal.');
  return inspectImage(bytes, ref.mime, ref.usage === 'ANDROID_AR');
}
