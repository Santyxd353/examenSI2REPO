BEGIN;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE ubicacion ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE ubicacion ADD COLUMN IF NOT EXISTS responsable_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_ubicacion_responsable') THEN
    ALTER TABLE ubicacion ADD CONSTRAINT fk_ubicacion_responsable
      FOREIGN KEY (responsable_id) REFERENCES usuario(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_usuario_version') THEN
    ALTER TABLE usuario ADD CONSTRAINT ck_usuario_version CHECK (version > 0);
    ALTER TABLE ubicacion ADD CONSTRAINT ck_ubicacion_version CHECK (version > 0);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_ubicacion_responsable_id ON ubicacion(responsable_id);
COMMIT;
