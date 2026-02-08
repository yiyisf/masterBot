import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '../../');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'cmaster.db');

/**
 * 数据库初始化与管理
 */
export function initDatabase(): DatabaseSync {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }

    const db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');

    // 创建表结构
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            title TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_pinned BOOLEAN DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT,
            tool_call_id TEXT,
            tool_calls TEXT, -- JSON string
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            name TEXT,
            type TEXT,
            url TEXT,
            base64 TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            dependencies TEXT DEFAULT '[]',
            result TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
    `);

    // Auto-migration for existing databases
    try {
        db.prepare('ALTER TABLE sessions ADD COLUMN is_pinned BOOLEAN DEFAULT 0').run();
    } catch (error: any) {
        // Ignore error if column already exists
        if (!error.message.includes('duplicate column name')) {
            // Log but don't crash if it's another error, though for this simple setup it's fine
        }
    }

    return db;
}

export const db: DatabaseSync = initDatabase();
