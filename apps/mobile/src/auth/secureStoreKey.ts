/**
 * Expo SecureStore para Android acepta identificadores no vacíos compuestos
 * únicamente por letras y números. Los slugs y los ámbitos internos pueden
 * incluir guiones o dos puntos, por eso nunca se usan directamente como clave.
 */
function encodeSegment(value: string) {
  const characters = Array.from(value);
  return `s${characters.length.toString(36)}x${characters
    .map((character) => character.codePointAt(0)!.toString(36).padStart(6, '0'))
    .join('')}`;
}

export function secureStoreKey(namespace: string, ...segments: string[]) {
  if (!/^[A-Za-z0-9]+$/.test(namespace)) throw new Error('El espacio de claves seguras no es válido.');
  const key = `${namespace}${segments.map(encodeSegment).join('')}`;
  if (!/^[A-Za-z0-9]+$/.test(key)) throw new Error('La clave segura contiene caracteres no permitidos.');
  return key;
}
