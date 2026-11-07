import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { captureSessionScope, assertCurrentSessionScope } from '../../api';

export async function shareDslCsv(csv: string) {
  return shareDslFile(csv, 'csv', 'text/csv');
}
export async function shareDslJson(json: string) {
  return shareDslFile(json, 'json', 'application/json');
}
async function shareDslFile(content: string, extension: string, mimeType: string) {
  const session = captureSessionScope();
  if (!(await Sharing.isAvailableAsync()))
    throw new Error('Compartir archivos no está disponible en este dispositivo.');
  assertCurrentSessionScope(session);
  const file = new File(Paths.cache, 'lumina-reporte-' + randomUUID() + '.' + extension);
  try {
    file.write(content);
    assertCurrentSessionScope(session);
    await Sharing.shareAsync(file.uri, {
      mimeType,
      dialogTitle: 'Compartir reporte Lúmina',
    });
  } finally {
    if (file.exists) file.delete();
  }
}
