CREATE TABLE offline_device_key (
  user_id uuid NOT NULL REFERENCES usuario(id),
  device_id uuid NOT NULL,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  tag text NOT NULL,
  version integer NOT NULL,
  created_at timestamptz NOT NULL,
  rotated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, device_id)
);

CREATE INDEX ix_offline_device_key_user ON offline_device_key(user_id);
