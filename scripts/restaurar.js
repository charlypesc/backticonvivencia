// Restaura un respaldo de scripts/backup.js en una base.
//
//   node scripts/restaurar.js backups/<archivo>.sql.gz --base=NOMBRE
//
// La base destino se crea si no existe, en el mismo servidor del .env. Se
// niega a escribir sobre:
//   - la base del .env (DB_NAME): restaurar encima de la que está en uso
//     reemplaza cada tabla por la del respaldo y pierde todo lo posterior;
//   - una base que ya tiene tablas, salvo --reemplazar.
// Para devolver la base en uso a un respaldo, primero se restaura en otra,
// se revisa, y recién ahí se apunta la aplicación a esa (DB_NAME).
//
// Sirve también para probar que los respaldos realmente se pueden restaurar:
// un respaldo que nunca se restauró es una suposición, no un respaldo.

require('dotenv').config();
const fs   = require('fs');
const zlib = require('zlib');
const mysql = require('mysql2/promise');

const [archivo, ...resto] = process.argv.slice(2);
const args = Object.fromEntries(
  resto.map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

if (!archivo || !args.base) {
  console.error('Uso: node scripts/restaurar.js <respaldo.sql.gz> --base=NOMBRE [--reemplazar]');
  process.exit(1);
}
if (!/^[A-Za-z0-9_]+$/.test(args.base)) {
  console.error('El nombre de la base solo puede tener letras, números y _');
  process.exit(1);
}
if (args.base === process.env.DB_NAME) {
  console.error(`${args.base} es la base en uso (DB_NAME). Restaurá en otra y después cambiá DB_NAME.`);
  process.exit(1);
}

// Cuántas sentencias por viaje: de a una, las ~12 mil filas tardarían media
// hora contra Aiven (~150 ms por ida y vuelta).
const LOTE = 300;

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
    timezone: 'Z',
  });

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${args.base}\` CHARACTER SET utf8mb4`);
  await conn.query(`USE \`${args.base}\``);
  const [[{ n }]] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
    [args.base]
  );
  if (n > 0 && !args.reemplazar) {
    console.error(`${args.base} ya tiene ${n} tabla(s). Usá --reemplazar si de verdad querés pisarla.`);
    process.exit(1);
  }

  // backup.js escribe cada sentencia terminada en ";\n" y los valores van
  // escapados (un salto de línea dentro de un texto es "\n" literal), así que
  // partir por ";\n" no corta ningún valor por la mitad.
  const sql = zlib.gunzipSync(fs.readFileSync(archivo)).toString('utf8');
  const sentencias = sql
    .split(/;\n/)
    .map((s) => s.replace(/^(--[^\n]*\n)+/, '').trim())
    .filter(Boolean);

  // Las del encabezado (SET ...) valen por sesión: tienen que ir en la misma
  // conexión antes que el resto, y así es porque se ejecuta todo en orden.
  for (let i = 0; i < sentencias.length; i += LOTE) {
    await conn.query(sentencias.slice(i, i + LOTE).join(';\n') + ';');
    process.stdout.write(`\r  ${Math.min(i + LOTE, sentencias.length)}/${sentencias.length} sentencias`);
  }
  console.log(`\nRestaurado en ${args.base}.`);
  await conn.end();
})().catch((err) => {
  console.error('\nRestauración fallida:', err.message);
  process.exit(1);
});
