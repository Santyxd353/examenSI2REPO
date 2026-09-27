import assert from 'node:assert/strict';
import test from 'node:test';
import { garmentImageFrame, garmentKind, garmentOutline, projectTorso } from '../src/pose';
import type { PoseResult } from '../modules/pose-landmarker/src';

const pose: PoseResult = {
  width: 400,
  height: 800,
  landmarks: Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 })),
};
pose.landmarks[11] = { x: 0.3, y: 0.35, visibility: 0.95 };
pose.landmarks[12] = { x: 0.7, y: 0.35, visibility: 0.95 };
pose.landmarks[23] = { x: 0.37, y: 0.65, visibility: 0.95 };
pose.landmarks[24] = { x: 0.63, y: 0.65, visibility: 0.95 };

test('proyecta puntos de hombros y cadera con recorte cover', () => {
  const torso = projectTorso(pose, { width: 300, height: 800 });
  assert.ok(torso);
  assert.equal(torso.leftShoulder.x, 70);
  assert.equal(torso.rightShoulder.x, 230);
  assert.equal(torso.leftHip.y, 520);
});

test('descarta pose poco visible y suaviza un movimiento', () => {
  const first = projectTorso(pose, { width: 400, height: 800 });
  assert.ok(first);
  const shifted = structuredClone(pose);
  shifted.landmarks[11]!.x += 0.1;
  shifted.landmarks[12]!.x += 0.1;
  const next = projectTorso(shifted, { width: 400, height: 800 }, first);
  assert.ok(next);
  assert.equal(next.leftShoulder.x, first.leftShoulder.x + 14);
  shifted.landmarks[11]!.visibility = 0.1;
  assert.equal(projectTorso(shifted, { width: 400, height: 800 }), null);
});

test('el vestido cubre más largo que una blusa', () => {
  const torso = projectTorso(pose, { width: 400, height: 800 });
  assert.ok(torso);
  assert.equal(garmentKind('Vestido floral'), 'dress');
  assert.equal(garmentKind('Blusa blanca'), 'top');
  assert.equal(garmentKind('POLO PARA MUJER'), 'top');
  assert.equal(garmentKind('Falda midi'), 'skirt');
  assert.equal(garmentKind('Pantalón'), 'unsupported');
  assert.ok(garmentOutline(torso, 'dress')[4]!.y > garmentOutline(torso, 'top')[4]!.y);
  assert.ok(garmentOutline(torso, 'skirt')[0]!.y >= torso.leftHip.y - 20);
});

test('la imagen ilustrativa se ancla a hombros y cadera', () => {
  const torso = projectTorso(pose, { width: 400, height: 800 });
  assert.ok(torso);
  const frame = garmentImageFrame(torso);
  assert.equal(frame.left + frame.width / 2, 200);
  assert.ok(frame.top < torso.leftShoulder.y);
  assert.ok(frame.top + frame.height > torso.leftHip.y);
});

test('un PNG de vestido llega bajo la cadera sin cambiar el anclaje de hombros', () => {
  const torso = projectTorso(pose, { width: 400, height: 800 });
  assert.ok(torso);
  const top = garmentImageFrame(torso, 'top');
  const dress = garmentImageFrame(torso, 'dress');
  assert.equal(dress.top, top.top);
  assert.equal(dress.left + dress.width / 2, 200);
  assert.ok(dress.top + dress.height >= 680);
  assert.ok(top.top + top.height < 600);
});

test('una falda se ancla a la cadera y no a los hombros', () => {
  const torso = projectTorso(pose, { width: 400, height: 800 });
  assert.ok(torso);
  const dress = garmentImageFrame(torso, 'dress');
  const skirt = garmentImageFrame(torso, 'skirt');
  assert.ok(skirt.top > dress.top);
  assert.ok(skirt.top >= torso.leftHip.y - 30);
  assert.equal(skirt.left + skirt.width / 2, 200);
});

test('el tipo AR se obtiene de una categoría reconocida, sin adivinar nombres comerciales', () => {
  assert.equal(garmentKind('Vestidos'), 'dress');
  assert.equal(garmentKind('Faldas'), 'skirt');
  assert.equal(garmentKind('Blusas'), 'top');
  assert.equal(garmentKind('Esenciales'), 'unsupported');
  assert.equal(garmentKind('Topacio'), 'unsupported');
});
