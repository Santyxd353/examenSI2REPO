import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ShieldCheck, Smartphone } from 'lucide-react';

type AndroidRelease = {
  versionName: string;
  versionCode: number;
  fileName: string;
  bytes: number;
  sha256: string;
  package: string;
};
function release(value: unknown): AndroidRelease {
  const data = value as Partial<AndroidRelease> | null;
  if (
    !data ||
    typeof data.versionName !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(data.versionName) ||
    !Number.isSafeInteger(data.versionCode) ||
    data.versionCode! < 1 ||
    typeof data.fileName !== 'string' ||
    !/^lumina-qa-[a-zA-Z0-9.-]+\.apk$/.test(data.fileName) ||
    typeof data.bytes !== 'number' ||
    !Number.isSafeInteger(data.bytes) ||
    data.bytes <= 0 ||
    typeof data.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(data.sha256) ||
    data.package !== 'bo.edu.grupo18.vestidorar.qa'
  )
    throw new Error('Release unavailable');
  return data as AndroidRelease;
}

export function AndroidDownload() {
  const [artifact, setArtifact] = useState<AndroidRelease | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    fetch('/descargas/android/latest.json', {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-cache',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return release(await response.json());
      })
      .then((data) => {
        setArtifact(data);
        setState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <section className="sh-android" id="android" aria-labelledby="sh-android-title">
      <div className="sh-android-copy">
        <span className="sh-eyebrow">TU NEGOCIO TAMBIÉN VA CONTIGO</span>
        <h2 id="sh-android-title">Lúmina, en tu Android.</h2>
        <p>
          Entra a tu tienda desde el celular. Consulta tu catálogo, gestiona tu negocio y prepara tu
          información para trabajar sin conexión.
        </p>
        <span className="sh-android-tag">
          <ShieldCheck size={15} /> Versión QA para pruebas académicas
        </span>
      </div>
      <div className="sh-android-card">
        <div className="sh-android-icon">
          <Smartphone size={29} />
        </div>
        <div>
          <strong>Lúmina QA</strong>
          <p>
            Se conecta al servidor de Azure. No necesita Expo ni mantener tu computadora encendida.
          </p>
        </div>
        {state === 'loading' ? (
          <p role="status">Consultando versión disponible…</p>
        ) : state === 'ready' && artifact ? (
          <>
            <a
              className="sh-button sh-button-primary"
              href={'/descargas/android/' + artifact.fileName}
              download={artifact.fileName}
            >
              Descargar APK para Android <ArrowDownToLine size={18} />
            </a>
            <span className="sh-android-meta">
              Versión {artifact.versionName} ·{' '}
              {new Intl.NumberFormat('es-BO', { maximumFractionDigits: 1 }).format(
                artifact.bytes / 1048576,
              )}{' '}
              MB · ARM64
            </span>
            <details>
              <summary>
                Cómo instalar y verificar <ArrowRight size={14} />
              </summary>
              <p>
                Abre este sitio desde tu celular Android, descarga la APK y abre el archivo para
                instalarla. Usa el identificador de tu tienda y tu cuenta habitual para ingresar.
              </p>
              <p>
                Es una versión de pruebas firmada con el certificado QA; no es una publicación de
                Google Play. Conserva el mismo paquete de Lúmina QA para permitir su actualización.
              </p>
              <p className="sh-apk-hash">
                SHA-256: <code>{artifact.sha256}</code>
              </p>
            </details>
          </>
        ) : (
          <div role="status">
            <p>No pudimos consultar la descarga. Revisa tu conexión y vuelve a intentarlo.</p>
            <button
              className="sh-text-link"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Reintentar <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
