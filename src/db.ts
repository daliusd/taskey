import Database from 'better-sqlite3';
import { ensureDbDir, getDbPath } from './paths.js';

export type Db = Database.Database;

export function openDb(path = getDbPath()): Db {
  ensureDbDir(path);
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const run = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        repo_key TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_repo_order ON tasks(repo_key, created_at, id);

      CREATE TABLE IF NOT EXISTS task_prerequisites (
        repo_key TEXT NOT NULL,
        task_id TEXT NOT NULL,
        prerequisite_id TEXT NOT NULL,
        PRIMARY KEY (repo_key, task_id, prerequisite_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (prerequisite_id) REFERENCES tasks(id)
      );

      CREATE INDEX IF NOT EXISTS idx_task_prerequisites_task ON task_prerequisites(repo_key, task_id);
      CREATE INDEX IF NOT EXISTS idx_task_prerequisites_prereq ON task_prerequisites(repo_key, prerequisite_id);
    `);
    db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (1)').run();
  });
  run();
}
