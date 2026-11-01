CREATE TABLE IF NOT EXISTS offline_sync_receipt (
  operation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES usuario(id),
  device_id uuid NOT NULL,
  status varchar(12) NOT NULL CHECK (status IN ('APPLIED','CONFLICT','REJECTED')),
  server_version integer,
  message varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_offline_sync_receipt_user_device
  ON offline_sync_receipt(user_id, device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS offline_entity_version (
  entity_type varchar(40) NOT NULL,
  entity_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  PRIMARY KEY (entity_type, entity_id)
);
