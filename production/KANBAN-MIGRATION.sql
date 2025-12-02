-- Kanban Board Tables Migration
-- Run this SQL in your Neon.tech database

-- 1. Create kanban_board table
CREATE TABLE IF NOT EXISTS mail0_kanban_board (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES mail0_user(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES mail0_connection(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS kanban_board_user_id_idx ON mail0_kanban_board(user_id);
CREATE INDEX IF NOT EXISTS kanban_board_connection_id_idx ON mail0_kanban_board(connection_id);
CREATE INDEX IF NOT EXISTS kanban_board_default_idx ON mail0_kanban_board(user_id, is_default);

-- 2. Create kanban_column table
CREATE TABLE IF NOT EXISTS mail0_kanban_column (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES mail0_kanban_board(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  position INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS kanban_column_board_id_idx ON mail0_kanban_column(board_id);
CREATE INDEX IF NOT EXISTS kanban_column_board_position_idx ON mail0_kanban_column(board_id, position);

-- 3. Create kanban_email_mapping table
CREATE TABLE IF NOT EXISTS mail0_kanban_email_mapping (
  id TEXT PRIMARY KEY,
  column_id TEXT NOT NULL REFERENCES mail0_kanban_column(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES mail0_connection(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE(thread_id, connection_id)
);

CREATE INDEX IF NOT EXISTS kanban_email_column_id_idx ON mail0_kanban_email_mapping(column_id);
CREATE INDEX IF NOT EXISTS kanban_email_thread_id_idx ON mail0_kanban_email_mapping(thread_id);
CREATE INDEX IF NOT EXISTS kanban_email_connection_id_idx ON mail0_kanban_email_mapping(connection_id);
