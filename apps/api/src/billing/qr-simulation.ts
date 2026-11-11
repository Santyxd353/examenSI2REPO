import QRCode from 'qrcode';
export async function simulatedQr(id: string, amountMinor: number, currency = 'BOB') {
  const payload = `LUMINA:QR_SIMULATED:${id}:${currency}:${amountMinor}`;
  return {
    simulated: true,
    qrPayload: payload,
    qrDataUrl: await QRCode.toDataURL(payload, {
      width: 280,
      margin: 4,
      errorCorrectionLevel: 'M',
    }),
  };
}
