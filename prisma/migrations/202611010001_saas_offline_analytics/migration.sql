-- ICONIX v2.0: ampliación aditiva. Sin filas sintéticas en comercio.
-- Repetible para preparación local; Prisma registra esta migración en cada negocio.
BEGIN;

CREATE TABLE IF NOT EXISTS operacion_sincronizacion (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id uuid NOT NULL,
  dispositivo_instalacion_id uuid NOT NULL,
  tipo varchar(40) NOT NULL,
  entidad_tipo varchar(30) NOT NULL,
  entidad_id uuid NOT NULL,
  version_base integer,
  hash_intencion char(64) NOT NULL,
  estado_resultado varchar(20) NOT NULL,
  resultado jsonb NOT NULL,
  recibida_en timestamptz(6) NOT NULL,
  confirmada_en timestamptz(6) NOT NULL,
  CONSTRAINT ck_operacion_sincronizacion_1 CHECK (estado_resultado IN ('APPLIED','CONFLICT','REJECTED')),
  CONSTRAINT ck_operacion_sincronizacion_2 CHECK (tipo IN ('CATALOG_CREATE','CATALOG_UPDATE','CATALOG_ARCHIVE','STOCK_DELTA','STOCK_COUNT','ONLINE_TRANSFER')),
  CONSTRAINT ck_operacion_sincronizacion_3 CHECK (hash_intencion ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_operacion_sincronizacion_4 CHECK (version_base IS NULL OR version_base >= 1),
  CONSTRAINT ck_operacion_sincronizacion_5 CHECK (confirmada_en >= recibida_en)
);

CREATE TABLE IF NOT EXISTS definicion_reporte (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  autor_id uuid NOT NULL,
  nombre varchar(120) NOT NULL,
  version integer NOT NULL,
  esquema_version integer NOT NULL,
  especificacion jsonb NOT NULL,
  diseno jsonb NOT NULL,
  estado varchar(20) NOT NULL,
  creada_en timestamptz(6) NOT NULL,
  actualizada_en timestamptz(6) NOT NULL,
  CONSTRAINT ck_definicion_reporte_1 CHECK (estado IN ('ACTIVA','ARCHIVADA')),
  CONSTRAINT ck_definicion_reporte_2 CHECK (version >= 1 AND esquema_version >= 1)
);

CREATE TABLE IF NOT EXISTS conjunto_reporte (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  definicion_id uuid,
  solicitante_id uuid NOT NULL,
  definicion_version integer,
  definicion_snapshot jsonb NOT NULL,
  esquema_version integer NOT NULL,
  cobertura jsonb NOT NULL,
  ambito_autorizado jsonb NOT NULL,
  clave_datos varchar(500) NOT NULL,
  sha256 char(64) NOT NULL,
  filas bigint NOT NULL,
  bytes bigint NOT NULL,
  generado_en timestamptz(6) NOT NULL,
  vence_en timestamptz(6),
  CONSTRAINT ck_conjunto_reporte_1 CHECK (filas >= 0 AND filas <= 50000 AND bytes >= 0),
  CONSTRAINT ck_conjunto_reporte_2 CHECK (esquema_version >= 1),
  CONSTRAINT ck_conjunto_reporte_3 CHECK ((definicion_id IS NULL) = (definicion_version IS NULL)),
  CONSTRAINT ck_conjunto_reporte_4 CHECK (sha256 ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS conjunto_entrenamiento (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre varchar(120) NOT NULL,
  version varchar(40) NOT NULL,
  origen varchar(20) NOT NULL,
  espacio_identificadores varchar(120) NOT NULL,
  esquema_version integer NOT NULL,
  desde date NOT NULL,
  hasta date NOT NULL,
  cortes_temporales jsonb NOT NULL,
  catalogo_referencia jsonb NOT NULL,
  ubicaciones_referencia jsonb NOT NULL,
  canales_referencia jsonb NOT NULL,
  parametros_generacion jsonb,
  clave_datos varchar(500) NOT NULL,
  sha256 char(64) NOT NULL,
  filas bigint NOT NULL,
  creado_por uuid NOT NULL,
  creado_en timestamptz(6) NOT NULL,
  CONSTRAINT ck_conjunto_entrenamiento_1 CHECK (origen IN ('REAL','IMPORTADO','SINTETICO')),
  CONSTRAINT ck_conjunto_entrenamiento_2 CHECK (desde <= hasta),
  CONSTRAINT ck_conjunto_entrenamiento_3 CHECK (filas >= 0),
  CONSTRAINT ck_conjunto_entrenamiento_4 CHECK (esquema_version >= 1),
  CONSTRAINT ck_conjunto_entrenamiento_5 CHECK (sha256 ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_conjunto_entrenamiento_nombre_version ON conjunto_entrenamiento(nombre,version);

CREATE TABLE IF NOT EXISTS metrica_modelo (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  modelo_id uuid NOT NULL,
  conjunto_id uuid NOT NULL,
  particion varchar(20) NOT NULL,
  nombre varchar(40) NOT NULL,
  valor numeric(20,8),
  valor_referencia numeric(20,8),
  horizonte_dias integer NOT NULL,
  segmento jsonb NOT NULL,
  segmento_hash char(64) NOT NULL,
  observaciones bigint NOT NULL,
  calculada_en timestamptz(6) NOT NULL,
  estado varchar(20) NOT NULL,
  motivo_no_aplica varchar(200),
  denominador numeric(20,8),
  CONSTRAINT ck_metrica_modelo_1 CHECK (particion IN ('VALIDACION','PRUEBA')),
  CONSTRAINT ck_metrica_modelo_2 CHECK (horizonte_dias IN (0,7,30)),
  CONSTRAINT ck_metrica_modelo_3 CHECK (observaciones >= 0),
  CONSTRAINT ck_metrica_modelo_4 CHECK (segmento_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_metrica_modelo_5 CHECK ((estado='EVALUABLE' AND valor IS NOT NULL) OR (estado='NO_APLICA' AND valor IS NULL AND motivo_no_aplica IS NOT NULL AND length(trim(motivo_no_aplica)) > 0)),
  CONSTRAINT ck_metrica_modelo_6 CHECK (NOT (upper(nombre)='WAPE' AND denominador=0) OR (estado='NO_APLICA' AND valor IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_metrica_modelo_modelo_id_conjunto_id_particio_d7c6745f ON metrica_modelo(modelo_id,conjunto_id,particion,nombre,horizonte_dias,segmento_hash);

CREATE TABLE IF NOT EXISTS consumo_cuota (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recurso varchar(40) NOT NULL,
  periodo_desde timestamptz(6) NOT NULL,
  periodo_hasta timestamptz(6) NOT NULL,
  idempotencia uuid NOT NULL,
  actor_id uuid NOT NULL,
  trabajo_avatar_id uuid,
  consulta_analitica_id uuid,
  cantidad integer NOT NULL,
  estado varchar(20) NOT NULL,
  plan_codigo_snapshot varchar(40) NOT NULL,
  suscripcion_version_snapshot integer NOT NULL,
  limite_snapshot integer NOT NULL,
  creado_en timestamptz(6) NOT NULL,
  actualizado_en timestamptz(6) NOT NULL,
  CONSTRAINT ck_consumo_cuota_1 CHECK (recurso IN ('AVATAR_GENERACION','IA_INTERPRETACION')),
  CONSTRAINT ck_consumo_cuota_2 CHECK (estado IN ('RESERVADO','CONFIRMADO','LIBERADO')),
  CONSTRAINT ck_consumo_cuota_3 CHECK (periodo_desde < periodo_hasta),
  CONSTRAINT ck_consumo_cuota_4 CHECK (cantidad > 0 AND limite_snapshot >= 0 AND suscripcion_version_snapshot >= 1),
  CONSTRAINT ck_consumo_cuota_5 CHECK ((recurso='AVATAR_GENERACION' AND trabajo_avatar_id IS NOT NULL AND consulta_analitica_id IS NULL) OR (recurso='IA_INTERPRETACION' AND consulta_analitica_id IS NOT NULL AND trabajo_avatar_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_consumo_cuota_recurso_idempotencia ON consumo_cuota(recurso,idempotencia);
CREATE UNIQUE INDEX IF NOT EXISTS ux_consumo_cuota_trabajo_avatar_id ON consumo_cuota(trabajo_avatar_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_consumo_cuota_consulta_analitica_id ON consumo_cuota(consulta_analitica_id);

ALTER TABLE producto ADD COLUMN IF NOT EXISTS version integer DEFAULT 1 NOT NULL;
ALTER TABLE producto ADD COLUMN IF NOT EXISTS actualizado_en timestamptz(6) DEFAULT now() NOT NULL;
ALTER TABLE variante ADD COLUMN IF NOT EXISTS version integer DEFAULT 1 NOT NULL;
ALTER TABLE variante ADD COLUMN IF NOT EXISTS actualizado_en timestamptz(6) DEFAULT now() NOT NULL;
ALTER TABLE modelo_analitico ADD COLUMN IF NOT EXISTS conjunto_entrenamiento_id uuid;
ALTER TABLE modelo_analitico ADD COLUMN IF NOT EXISTS algoritmo varchar(100);
ALTER TABLE modelo_analitico ADD COLUMN IF NOT EXISTS clave_artefacto varchar(500);
ALTER TABLE modelo_analitico ADD COLUMN IF NOT EXISTS sha256_artefacto char(64);
ALTER TABLE modelo_analitico ADD COLUMN IF NOT EXISTS entrenado_en timestamptz(6);
ALTER TABLE modelo_analitico ADD COLUMN IF NOT EXISTS procedencia varchar(20) DEFAULT 'REGLA_LEGADA' NOT NULL;
ALTER TABLE ejecucion_analitica ADD COLUMN IF NOT EXISTS conjunto_id uuid;
ALTER TABLE ejecucion_analitica ADD COLUMN IF NOT EXISTS ambito_ubicaciones jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE ejecucion_analitica ADD COLUMN IF NOT EXISTS modo varchar(20) DEFAULT 'REGLA' NOT NULL;
ALTER TABLE ejecucion_analitica ADD COLUMN IF NOT EXISTS resultado_demostracion jsonb;
ALTER TABLE ejecucion_analitica ADD COLUMN IF NOT EXISTS terminada_en timestamptz(6);
ALTER TABLE ejecucion_analitica ADD COLUMN IF NOT EXISTS limitaciones jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE consulta_analitica ADD COLUMN IF NOT EXISTS definicion_reporte_id uuid;
ALTER TABLE consulta_analitica ADD COLUMN IF NOT EXISTS canal_entrada varchar(10) DEFAULT 'FORMULARIO' NOT NULL;
ALTER TABLE consulta_analitica ADD COLUMN IF NOT EXISTS proveedor_ia varchar(80);
ALTER TABLE consulta_analitica ADD COLUMN IF NOT EXISTS modelo_ia varchar(100);

UPDATE inventario SET version=1 WHERE version < 1;
DO $$ BEGIN ALTER TABLE operacion_sincronizacion ADD CONSTRAINT fk_operacion_sincronizacion_actor_id FOREIGN KEY (actor_id) REFERENCES usuario(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_operacion_sincronizacion_actor_id ON operacion_sincronizacion(actor_id);
DO $$ BEGIN ALTER TABLE definicion_reporte ADD CONSTRAINT fk_definicion_reporte_autor_id FOREIGN KEY (autor_id) REFERENCES usuario(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_definicion_reporte_autor_id ON definicion_reporte(autor_id);
DO $$ BEGIN ALTER TABLE conjunto_reporte ADD CONSTRAINT fk_conjunto_reporte_definicion_id FOREIGN KEY (definicion_id) REFERENCES definicion_reporte(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_conjunto_reporte_definicion_id ON conjunto_reporte(definicion_id);
DO $$ BEGIN ALTER TABLE conjunto_reporte ADD CONSTRAINT fk_conjunto_reporte_solicitante_id FOREIGN KEY (solicitante_id) REFERENCES usuario(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_conjunto_reporte_solicitante_id ON conjunto_reporte(solicitante_id);
DO $$ BEGIN ALTER TABLE conjunto_entrenamiento ADD CONSTRAINT fk_conjunto_entrenamiento_creado_por FOREIGN KEY (creado_por) REFERENCES usuario(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_conjunto_entrenamiento_creado_por ON conjunto_entrenamiento(creado_por);
DO $$ BEGIN ALTER TABLE metrica_modelo ADD CONSTRAINT fk_metrica_modelo_modelo_id FOREIGN KEY (modelo_id) REFERENCES modelo_analitico(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_metrica_modelo_modelo_id ON metrica_modelo(modelo_id);
DO $$ BEGIN ALTER TABLE metrica_modelo ADD CONSTRAINT fk_metrica_modelo_conjunto_id FOREIGN KEY (conjunto_id) REFERENCES conjunto_entrenamiento(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_metrica_modelo_conjunto_id ON metrica_modelo(conjunto_id);
DO $$ BEGIN ALTER TABLE consumo_cuota ADD CONSTRAINT fk_consumo_cuota_actor_id FOREIGN KEY (actor_id) REFERENCES usuario(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_consumo_cuota_actor_id ON consumo_cuota(actor_id);
DO $$ BEGIN ALTER TABLE consumo_cuota ADD CONSTRAINT fk_consumo_cuota_trabajo_avatar_id FOREIGN KEY (trabajo_avatar_id) REFERENCES trabajo_avatar(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_consumo_cuota_trabajo_avatar_id ON consumo_cuota(trabajo_avatar_id);
DO $$ BEGIN ALTER TABLE consumo_cuota ADD CONSTRAINT fk_consumo_cuota_consulta_analitica_id FOREIGN KEY (consulta_analitica_id) REFERENCES consulta_analitica(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_consumo_cuota_consulta_analitica_id ON consumo_cuota(consulta_analitica_id);
DO $$ BEGIN ALTER TABLE modelo_analitico ADD CONSTRAINT fk_modelo_analitico_conjunto_entrenamiento_id FOREIGN KEY (conjunto_entrenamiento_id) REFERENCES conjunto_entrenamiento(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_modelo_analitico_conjunto_entrenamiento_id ON modelo_analitico(conjunto_entrenamiento_id);
DO $$ BEGIN ALTER TABLE ejecucion_analitica ADD CONSTRAINT fk_ejecucion_analitica_conjunto_id FOREIGN KEY (conjunto_id) REFERENCES conjunto_entrenamiento(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_ejecucion_analitica_conjunto_id ON ejecucion_analitica(conjunto_id);
DO $$ BEGIN ALTER TABLE consulta_analitica ADD CONSTRAINT fk_consulta_analitica_definicion_reporte_id FOREIGN KEY (definicion_reporte_id) REFERENCES definicion_reporte(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_consulta_analitica_definicion_reporte_id ON consulta_analitica(definicion_reporte_id);
DO $$ BEGIN ALTER TABLE producto ADD CONSTRAINT ck_producto_version CHECK (version >= 1); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE variante ADD CONSTRAINT ck_variante_version CHECK (version >= 1); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE modelo_analitico DROP CONSTRAINT IF EXISTS ck_modelo_analitico_procedencia;
ALTER TABLE modelo_analitico ADD CONSTRAINT ck_modelo_analitico_procedencia CHECK (procedencia IN ('REGLA_LEGADA','ENTRENADO_REAL','DEMOSTRACION') AND (procedencia='REGLA_LEGADA' OR (conjunto_entrenamiento_id IS NOT NULL AND algoritmo IS NOT NULL AND clave_artefacto IS NOT NULL AND sha256_artefacto IS NOT NULL AND sha256_artefacto ~ '^[a-f0-9]{64}$' AND entrenado_en IS NOT NULL)));
DO $$ BEGIN ALTER TABLE ejecucion_analitica ADD CONSTRAINT ck_ejecucion_analitica_modo CHECK (modo IN ('REAL','DEMOSTRACION','REGLA')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE consulta_analitica ADD CONSTRAINT ck_consulta_analitica_canal CHECK (canal_entrada IN ('FORMULARIO','TEXTO','VOZ')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_operacion_sincronizacion_actor_fecha ON operacion_sincronizacion(actor_id,confirmada_en);
CREATE INDEX IF NOT EXISTS ix_cuota_periodo_estado ON consumo_cuota(recurso,periodo_desde,periodo_hasta,estado);
COMMIT;
