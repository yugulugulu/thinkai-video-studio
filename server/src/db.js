import "./env.js";
import pg from "pg";
import { envNumber, envString } from "./env.js";

const { Pool } = pg;

const pool = new Pool({
  host: envString("PGHOST", "localhost"),
  port: envNumber("PGPORT", 5432),
  user: envString("PGUSER", "postgres"),
  password: envString("PGPASSWORD", "postgres"),
  database: envString("PGDATABASE", "thinkai_video_studio")
});

export async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      api_key TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    DELETE FROM api_keys a
    USING api_keys b
    WHERE a.user_id = b.user_id
      AND a.id < b.id
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'api_keys_user_id_unique'
      ) THEN
        ALTER TABLE api_keys
        ADD CONSTRAINT api_keys_user_id_unique UNIQUE (user_id);
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
      filename TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_tasks (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL UNIQUE,
      client_task_id TEXT,
      status TEXT NOT NULL,
      progress DOUBLE PRECISION NOT NULL DEFAULT 0,
      model TEXT,
      payload JSONB,
      task JSONB,
      file JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS video_tasks_user_updated_idx
    ON video_tasks (user_id, updated_at DESC)
  `);
}

export function query(text, params) {
  return pool.query(text, params);
}
