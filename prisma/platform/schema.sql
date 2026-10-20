CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.plan (
  code varchar(40) PRIMARY KEY,
  name varchar(100) NOT NULL,
  monthly_amount numeric(12,2) CHECK (monthly_amount >= 0),
  currency varchar(3) NOT NULL DEFAULT 'BOB',
  stripe_price_id varchar(200),
  limits jsonb NOT NULL,
  features jsonb NOT NULL,
  published boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS platform.tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(63) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name varchar(120) NOT NULL,
  database_name varchar(63) NOT NULL UNIQUE CHECK (database_name ~ '^[a-zA-Z0-9_]+$'),
  state varchar(20) NOT NULL CHECK (state IN ('PROVISIONING','ACTIVE','TRIAL','SUSPENDED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.subscription (
  tenant_id uuid PRIMARY KEY REFERENCES platform.tenant(id),
  plan_code varchar(40) NOT NULL REFERENCES platform.plan(code),
  status varchar(20) NOT NULL CHECK (status IN ('TRIALING','ACTIVE','PAST_DUE','CANCELED','SUSPENDED')),
  provider varchar(20) NOT NULL CHECK (provider IN ('NONE','STRIPE','QR_SIMULATED')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  stripe_customer_id varchar(200),
  stripe_subscription_id varchar(200) UNIQUE,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.billing_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES platform.tenant(id),
  provider varchar(20) NOT NULL,
  external_id varchar(200) NOT NULL,
  event_type varchar(100) NOT NULL,
  status varchar(20) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, external_id)
);
