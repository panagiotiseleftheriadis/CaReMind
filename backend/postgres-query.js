function translatePlaceholders(sql) {
  let result = "";
  let parameterIndex = 0;
  let quote = null;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (quote) {
      result += character;
      if (character === quote) {
        if (next === quote) {
          result += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      result += character;
      continue;
    }

    if (character === "?") {
      parameterIndex += 1;
      result += `$${parameterIndex}`;
      continue;
    }

    result += character;
  }

  return result;
}

function quoteCamelCaseAliases(sql) {
  return sql.replace(/\bAS\s+([a-z_][a-zA-Z0-9_]*)/gi, (match, alias) =>
    /[A-Z]/.test(alias) ? `AS "${alias}"` : match
  );
}

function addInsertReturningId(sql) {
  if (!/^\s*INSERT\s+INTO\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
    return sql;
  }

  return `${sql.replace(/;\s*$/, "")} RETURNING id`;
}

function translateSql(sql) {
  return addInsertReturningId(quoteCamelCaseAliases(translatePlaceholders(String(sql))));
}

function numericId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

function mysqlCompatibleResult(result) {
  if (result.command === "INSERT") {
    return [
      {
        insertId: numericId(result.rows[0]?.id),
        affectedRows: result.rowCount,
      },
      result.fields,
    ];
  }

  if (result.command === "UPDATE" || result.command === "DELETE") {
    return [{ affectedRows: result.rowCount }, result.fields];
  }

  return [result.rows, result.fields];
}

async function runQuery(executor, sql, params = []) {
  const result = await executor.query(translateSql(sql), params);
  return mysqlCompatibleResult(result);
}

async function getConnection(pool) {
  const client = await pool.connect();
  return {
    query: (sql, params) => runQuery(client, sql, params),
    beginTransaction: () => client.query("BEGIN"),
    commit: () => client.query("COMMIT"),
    rollback: () => client.query("ROLLBACK"),
    release: (error) => client.release(error),
  };
}

module.exports = { runQuery, translateSql, getConnection };
