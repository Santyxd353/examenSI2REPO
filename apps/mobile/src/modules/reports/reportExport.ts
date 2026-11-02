import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { OfflineDashboardReport } from './offlineReport';
import { reportCsv, reportPdfHtml } from './reportExportData';
export { reportCsv, reportPdfHtml } from './reportExportData';

async function share(uri: string, mimeType: string, title: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Compartir archivos no está disponible en este dispositivo.');
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
}

export async function shareReportCsv(report: OfflineDashboardReport, from: string, to: string) {
  const file = new File(Paths.cache, `reporte-lumina-${from}-${to}.csv`);
  file.write(reportCsv(report, from, to));
  await share(file.uri, 'text/csv', 'Compartir reporte CSV');
}

export async function shareReportPdf(report: OfflineDashboardReport, from: string, to: string) {
  const file = await Print.printToFileAsync({ html: reportPdfHtml(report, from, to), base64: false });
  await share(file.uri, 'application/pdf', 'Compartir reporte PDF');
}
