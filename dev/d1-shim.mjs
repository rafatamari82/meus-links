// Minimal D1 stand-in on node:sqlite, for local runs and tests only.
import { DatabaseSync } from "node:sqlite";

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args.map((a) => (a === undefined ? null : a))); }
  _s() { return this.db.prepare(this.sql); }
  async first(col) {
    const row = this._s().get(...this.args);
    if (!row) return null;
    const plain = { ...row };
    return col ? plain[col] : plain;
  }
  async all() { return { results: this._s().all(...this.args).map((r) => ({ ...r })), success: true }; }
  async run() { const r = this._s().run(...this.args); return { success: true, meta: { changes: Number(r.changes) } }; }
  _runSync() { const r = this._s().run(...this.args); return { success: true, meta: { changes: Number(r.changes) } }; }
}

export class D1Shim {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec("pragma foreign_keys = on; pragma journal_mode = wal;");
  }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) {
    this.db.exec("begin");
    try {
      const out = stmts.map((s) => s._runSync());
      this.db.exec("commit");
      return out;
    } catch (e) {
      this.db.exec("rollback");
      throw e;
    }
  }
}
