-- Solo registro de control. Nunca conectar por una tienda del cliente.
ALTER TABLE platform.subscription ADD COLUMN IF NOT EXISTS current_period_start timestamptz;
ALTER TABLE platform.subscription ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;
ALTER TABLE platform.billing_event ADD COLUMN IF NOT EXISTS payload_hash char(64);
ALTER TABLE platform.billing_event ADD COLUMN IF NOT EXISTS firma_verificada boolean NOT NULL DEFAULT false;
ALTER TABLE platform.billing_event ADD COLUMN IF NOT EXISTS procesado_en timestamptz;
ALTER TABLE platform.billing_event ADD COLUMN IF NOT EXISTS error_codigo varchar(80);
ALTER TABLE platform.billing_event ADD COLUMN IF NOT EXISTS suscripcion_version_aplicada integer;
ALTER TABLE platform.billing_event ADD COLUMN IF NOT EXISTS contexto jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  ALTER TABLE platform.subscription ADD CONSTRAINT ck_subscription_period
    CHECK (current_period_start IS NULL OR current_period_end IS NULL OR current_period_start < current_period_end);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_billing_event_tenant_received ON platform.billing_event(tenant_id,received_at);
