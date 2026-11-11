-- Registration capabilities and password hashes never enter business databases or public responses.
CREATE TABLE platform.signup (
  id uuid PRIMARY KEY,
  capability_hash char(64) NOT NULL,
  request_hash char(64) NOT NULL,
  slug varchar(63) NOT NULL,
  company_name varchar(120) NOT NULL,
  owner_email varchar(160) NOT NULL,
  first_name varchar(100) NOT NULL,
  last_name varchar(120) NOT NULL,
  password_hash varchar(100),
  plan_code varchar(40) NOT NULL REFERENCES platform.plan(code),
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  billing_interval varchar(10) NOT NULL CHECK (billing_interval IN ('MONTHLY','YEARLY','DEMO')),
  provider varchar(20) NOT NULL CHECK (provider IN ('STRIPE_TEST','QR_SIMULATED','NONE')),
  state varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','PAID','PROVISIONING','ACTIVE','REVIEW','EXPIRED')),
  session_id varchar(200) UNIQUE,
  checkout_url text,
  tenant_id uuid REFERENCES platform.tenant(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  activated_at timestamptz
);
CREATE UNIQUE INDEX signup_reserved_slug ON platform.signup(slug) WHERE state <> 'EXPIRED';
CREATE INDEX signup_created_at ON platform.signup(created_at);
CREATE UNIQUE INDEX signup_one_demo_per_email ON platform.signup(owner_email) WHERE billing_interval='DEMO';
