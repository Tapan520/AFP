// ?????????????????????????????????????????????????????????????????????????????
// db.js  -  MySQL pool (migrated from PostgreSQL)
//
// This module exposes a `pool.query(sql, params)` API that is source-compatible
// with the original `pg` (node-postgres) usage across the codebase, so the
// route files (which contain many `$1, $2, ... RETURNING, ILIKE, ::int, ...`
// patterns) do not need to be rewritten.
//
// It performs the following translations before delegating to mysql2:
//   • $1, $2, ... positional placeholders ? ?
//   • ILIKE                               ? LIKE
//   • ::int / ::text / ::bigint casts     ? CAST(... AS SIGNED / CHAR)  (stripped)
//   • COUNT(x) FILTER(WHERE cond)         ? COUNT(CASE WHEN cond THEN x END)
//   • col = ANY($n::text[])               ? FIND_IN_SET(col, ?) with array joined
//   • RETURNING ...                       ? stripped; result shim exposes
//                                           insertId/affectedRows and, when the
//                                           statement is an UPDATE/INSERT of a
//                                           single row identifiable by id, a
//                                           follow-up SELECT is executed to
//                                           mimic PostgreSQL's RETURNING.
//   • ON CONFLICT (...) DO NOTHING        ? INSERT IGNORE
//   • TIMESTAMPTZ                         ? TIMESTAMP
//   • SERIAL                              ? INT AUTO_INCREMENT
//   • NOW() etc. remain valid MySQL functions.
//
// The result object returned by `pool.query()` always has a `rows` property
// (like pg), so consumers can keep destructuring `const { rows } = await ...`.
// ?????????????????????????????????????????????????????????????????????????????
require("dotenv").config();
const mysql = require("mysql2/promise");

// ?? Connection configuration ????????????????????????????????????????????????
// Preferred: individual MYSQL_* env vars.
// Fallback:  DATABASE_URL (mysql://user:pass@host:port/db) for Railway/etc.
function buildConfig() {
  const url = process.env.DATABASE_URL;
  if (url && /^mysql/i.test(url)) {
    return {
      uri: url,
      waitForConnections: true,
      connectionLimit: 10,
      multipleStatements: true,
      dateStrings: false,
    };
  }
  return {
    host:     process.env.MYSQL_HOST     || "localhost",
    port:     +(process.env.MYSQL_PORT   || 3306),
    user:     process.env.MYSQL_USER     || "root",
    password: process.env.MYSQL_PASSWORD || "root123",
    database: process.env.MYSQL_DATABASE || "afp_nagarnigam",
    waitForConnections: true,
    connectionLimit: 10,
    multipleStatements: true,
    dateStrings: false,
  };
}

const cfg     = buildConfig();
const rawPool = cfg.uri ? mysql.createPool(cfg.uri) : mysql.createPool(cfg);

// ?? SQL translation helpers ?????????????????????????????????????????????????

function translateSql(sql, params) {
  let out = sql;

  // 1) Strip PostgreSQL type casts like ::int / ::text / ::bigint / ::text[]
  //    (they are used only for output formatting in the original code)
  out = out.replace(/::\s*(int|integer|bigint|smallint|text|varchar|numeric|float|double|boolean|bool)\s*(\[\])?/gi, "");

  // 2) ILIKE ? LIKE   (MySQL string comparisons are case-insensitive by default
  //    when using a case-insensitive collation, which is the default).
  out = out.replace(/\bILIKE\b/gi, "LIKE");

  // 3) COUNT(expr) FILTER (WHERE cond)
  //    - COUNT(*)  FILTER (WHERE cond) ? SUM(CASE WHEN cond THEN 1 ELSE 0 END)
  //    - COUNT(x)  FILTER (WHERE cond) ? COUNT(CASE WHEN cond THEN x END)
  out = out.replace(
    /COUNT\s*\(\s*([^)]+?)\s*\)\s*FILTER\s*\(\s*WHERE\s+([\s\S]+?)\s*\)/gi,
    (_m, expr, cond) => {
      const trimmed = expr.trim();
      if (trimmed === "*") {
        return `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END)`;
      }
      return `COUNT(CASE WHEN ${cond} THEN ${trimmed} END)`;
    }
  );

  // 4) col = ANY($n::text[])  or  col = ANY($n)
  //    Translate to: col IN ($n_1, $n_2, ...) inline. Actual expansion into
  //    ? placeholders + param splicing happens in the $?? pass below via the
  //    `anyExpansions` map, so ordering stays correct even when multiple $N
  //    references follow the ANY(...) call.
  const anyExpansions = new Map(); // $N (1-based) ? arrayValue
  out = out.replace(
    /(\S+)\s*=\s*ANY\s*\(\s*\$(\d+)(?:::[a-z\[\]]+)?\s*\)/gi,
    (_m, col, idxStr) => {
      const idx1 = parseInt(idxStr, 10);
      const arr = Array.isArray(params[idx1 - 1])
        ? params[idx1 - 1]
        : [params[idx1 - 1]];
      anyExpansions.set(idx1, arr);
      // Emit a sentinel we'll expand during the $?? pass.
      return `${col} IN ($${idxStr})`;
    }
  );

  // 5) ON CONFLICT (...) DO NOTHING  ?  INSERT IGNORE  (transform the whole
  //    statement).  Also handle bare "ON CONFLICT DO NOTHING".
  if (/ON\s+CONFLICT[\s\S]*DO\s+NOTHING/i.test(out)) {
    out = out.replace(/^\s*INSERT\s+INTO/i, "INSERT IGNORE INTO");
    out = out.replace(/ON\s+CONFLICT[^;]*DO\s+NOTHING/gi, "");
  }

  // 6) Strip RETURNING ... clause (we handle its semantics after execution).
  let returning = null;
  out = out.replace(/\bRETURNING\b\s+([\s\S]+?)(?=(?:$|;))/i, (_m, cols) => {
    returning = cols.trim();
    return "";
  });

  // 7) Schema DDL compatibility (used by server.js runtime migrations)
  out = out.replace(/\bSERIAL\b/gi, "INT AUTO_INCREMENT");
  out = out.replace(/\bTIMESTAMPTZ\b/gi, "TIMESTAMP");
  out = out.replace(/\bBIGSERIAL\b/gi, "BIGINT AUTO_INCREMENT");
  // MySQL 8 supports "CREATE INDEX IF NOT EXISTS" only in some versions; guard.
  // We'll leave it as-is and swallow duplicate-index errors below.

  // 8) Rewrite $1, $2, ... to ? in the order they appear, expanding any
  //    ANY(...) references into a comma-separated list of ? placeholders.
  const expandedParams = [];
  const finalSql = out.replace(/\$(\d+)/g, (_m, n) => {
    const idx1 = parseInt(n, 10);
    if (anyExpansions.has(idx1)) {
      const arr = anyExpansions.get(idx1);
      if (arr.length === 0) {
        // Emit a value that will make `IN (...)` a no-match; but the enclosing
        // "col IN ($n)" pattern requires at least one placeholder to remain
        // syntactically valid. Use a NULL literal instead.
        return "NULL";
      }
      arr.forEach((v) => expandedParams.push(v));
      return arr.map(() => "?").join(",");
    }
    expandedParams.push(params[idx1 - 1]);
    return "?";
  });

  return { sql: finalSql, params: expandedParams, returning };
}

// ?? Result shim ?????????????????????????????????????????????????????????????
// Executes the (possibly translated) SQL and, if `returning` was requested and
// this is an INSERT/UPDATE/DELETE against a table with an `id` column, performs
// a follow-up SELECT to emulate PostgreSQL's RETURNING clause.

async function query(sql, params = []) {
  const { sql: mySql, params: myParams, returning } = translateSql(sql, params || []);

  // For DDL scripts that use IF NOT EXISTS on indexes, MySQL <8.0.x may throw
  // ER_DUP_KEYNAME (1061). Swallow it so migrations remain idempotent.
  let result, fields;
  try {
    [result, fields] = await rawPool.query(mySql, myParams);
  } catch (err) {
    if (
      err &&
      (err.code === "ER_DUP_KEYNAME" ||
        err.code === "ER_DUP_FIELDNAME" ||
        err.code === "ER_CANT_DROP_FIELD_OR_KEY")
    ) {
      return { rows: [], rowCount: 0 };
    }
    // Translate MySQL duplicate-entry to Postgres SQLSTATE 23505 so route
    // handlers that check `err.code === "23505"` keep working.
    if (err && err.code === "ER_DUP_ENTRY") {
      err.code = "23505";
    }
    throw err;
  }

  // SELECT ? result is an array of rows
  if (Array.isArray(result)) {
    return { rows: result, rowCount: result.length, fields };
  }

  // INSERT / UPDATE / DELETE ? result is a ResultSetHeader
  // Emulate RETURNING by re-selecting the affected row(s) when possible.
  if (returning) {
    const trimmedSql = sql.trim();
    const upper = trimmedSql.toUpperCase();

    // Extract table name
    let table = null;
    let idExpr = null;
    let idValue = null;

    if (upper.startsWith("INSERT")) {
      const m = trimmedSql.match(/INSERT\s+(?:IGNORE\s+)?INTO\s+([A-Za-z_][\w]*)/i);
      if (m) {
        table = m[1];
        idExpr = "id";
        idValue = result.insertId;
      }
    } else if (upper.startsWith("UPDATE")) {
      const m = trimmedSql.match(/UPDATE\s+([A-Za-z_][\w]*)/i);
      if (m) table = m[1];
      // Try to detect a WHERE id = $N and re-select that row.
      const w = trimmedSql.match(/WHERE[\s\S]*?\bid\s*=\s*\$(\d+)/i);
      if (w) {
        idExpr = "id";
        idValue = params[parseInt(w[1], 10) - 1];
      }
    } else if (upper.startsWith("DELETE")) {
      const m = trimmedSql.match(/DELETE\s+FROM\s+([A-Za-z_][\w]*)/i);
      if (m) table = m[1];
      const w = trimmedSql.match(/WHERE[\s\S]*?\bid\s*=\s*\$(\d+)/i);
      if (w) {
        // For DELETE we can't SELECT after the fact; but callers only need
        // to know whether a row existed. Return synthetic {id} rows.
        const rows = result.affectedRows > 0
          ? [{ id: params[parseInt(w[1], 10) - 1] }]
          : [];
        return { rows, rowCount: result.affectedRows };
      }
    }

    if (table && idExpr && idValue !== undefined && idValue !== null) {
      // For UPDATE, if no row was actually updated (extra WHERE conditions
      // didn't match), return an empty rowset so callers relying on
      // `!rows.length` to detect "not found / not owned" continue to work.
      if (upper.startsWith("UPDATE") && result.affectedRows === 0) {
        return { rows: [], rowCount: 0 };
      }
      const cols = returning === "*" ? "*" : returning;
      const [rows] = await rawPool.query(
        `SELECT ${cols} FROM ${table} WHERE ${idExpr} = ? LIMIT 1`,
        [idValue]
      );
      return {
        rows,
        rowCount: result.affectedRows ?? rows.length,
        insertId: result.insertId,
      };
    }

    // Fallback: no way to synthesize RETURNING data
    return {
      rows: result.affectedRows > 0 ? [{}] : [],
      rowCount: result.affectedRows ?? 0,
      insertId: result.insertId,
    };
  }

  return {
    rows: [],
    rowCount: result.affectedRows ?? 0,
    insertId: result.insertId,
  };
}

const pool = {
  query,
  on: (event, cb) => {
    // mysql2 pool exposes 'connection'/'acquire'/'release'/etc. We forward
    // 'error' calls to the underlying pool for parity with the pg version.
    if (event === "error") {
      rawPool.on("error", cb);
    }
  },
  end: () => rawPool.end(),
  raw: rawPool,
};

module.exports = pool;
