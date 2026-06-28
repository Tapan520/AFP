-- Migration: create report_comments table
-- Run this against your PostgreSQL database before deploying the comments feature.

CREATE TABLE IF NOT EXISTS report_comments (
    id          SERIAL      PRIMARY KEY,
    report_id   INTEGER     NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    admin_id    INTEGER     NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    comment     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_comments_report_id
    ON report_comments(report_id);
