// Respaldo completo de la base: DDL de cada tabla y vista + todas las filas,
// en un único .sql.gz que se restaura con scripts/restaurar.js.
//
//   node scripts/backup.js                    → backups/<DB_NAME>-<fecha>.sql.gz
//   node scripts/backup.js --solo-esquema     → solo DDL (para crear una base vacía)
//   node scripts/backup.js --dir=/otra/ruta   → dónde dejar el archivo
//   node scripts/backup.js --retener=14       → borra los respaldos de esa base con más de 14 días
//
// Existe porque la máquina no tiene mysqldump y porque las actas, escaneos y
// PDFs viven en la base como BLOB: sin un respaldo propio, perder la base es
// perder la prueba documental de todos los casos. Los BLOB se escriben en
// hexadecimal (0x...) para que el .sql sea texto plano y no dependa del
// charset de quien lo restaure.
//
// Es solo lectura sobre la base. Lee por páginas para no cargar en memoria
// una tabla entera de archivos.

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const mysql = require('mysql2/promise');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const SOLO_ESQUEMA = Boolean(args['solo-esquema']);
const DIR = path.resolve(args.dir || path.join(__dirname, '..', 'backups'));
const RETENER_DIAS = args.retener ? Number(args.retener) : null;
const PAGINA = 500;

const valorSql = (conn, v) => {
  if (v === null || v === undefined) return 'NULL';
  if (Buffer.isBuffer(v)) return v.length ? '0x' + v.toString('hex') : "''";
  if (v instanceof Date) return conn.escape(v.toISOString().slice(0, 19).replace('T', ' '));
  if (typeof v === 'object') return conn.escape(JSON.stringify(v));
  return conn.escape(v);
};

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    // Igual que el pool: las fechas se leen y se escriben en UTC, sin
    // correrlas por la zona horaria de la máquina que respalda.
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });

  fs.mkdirSync(DIR, { recursive: true });
  const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const nombre = `${process.env.DB_NAME}-${sello}${SOLO_ESQUEMA ? '-esquema' : ''}.sql.gz`;
  const destino = path.join(DIR, nombre);
  const parcial = destino + '.parcial';

  const gz = zlib.createGzip();
  const archivo = fs.createWriteStream(parcial);
  gz.pipe(archivo);
  // Respeta el backpressure del gzip: sin esto, una tabla grande de BLOB se
  // acumula entera en memoria esperando a que se escriba.
  const escribir = (texto) =>
    new Promise((ok) => (gz.write(texto) ? ok() : gz.once('drain', ok)));

  await escribir(
    `-- Respaldo de ${process.env.DB_NAME} — ${new Date().toISOString()}\n` +
    `SET NAMES utf8mb4;\nSET time_zone = '+00:00';\nSET FOREIGN_KEY_CHECKS = 0;\n\n`
  );

  const [objetos] = await conn.query(
    `SELECT TABLE_NAME AS nombre, TABLE_TYPE AS tipo
     FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_TYPE, TABLE_NAME`
  );
  const tablas = objetos.filter((o) => o.tipo === 'BASE TABLE').map((o) => o.nombre);
  const vistas = objetos.filter((o) => o.tipo === 'VIEW').map((o) => o.nombre);

  let totalFilas = 0;
  for (const tabla of tablas) {
    const [[ddl]] = await conn.query(`SHOW CREATE TABLE \`${tabla}\``);
    await escribir(`DROP TABLE IF EXISTS \`${tabla}\`;\n${ddl['Create Table']};\n\n`);
    if (SOLO_ESQUEMA) continue;

    // Orden estable por la clave primaria, para que el paginado no repita ni
    // salte filas.
    const [pk] = await conn.query(
      `SELECT COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION`,
      [tabla]
    );
    const orden = pk.length ? `ORDER BY ${pk.map((p) => `\`${p.c}\``).join(', ')}` : '';

    // Las columnas generadas las recalcula MySQL: insertarlas hace fallar la
    // restauración entera.
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%'
       ORDER BY ORDINAL_POSITION`,
      [tabla]
    );
    const nombres = cols.map((x) => x.c);
    const columnas = nombres.map((c) => `\`${c}\``).join(', ');

    let filasTabla = 0;
    for (let offset = 0; ; offset += PAGINA) {
      const [filas] = await conn.query(
        `SELECT ${columnas} FROM \`${tabla}\` ${orden} LIMIT ${PAGINA} OFFSET ${offset}`
      );
      if (filas.length === 0) break;
      for (const fila of filas) {
        const valores = nombres.map((c) => valorSql(conn, fila[c])).join(', ');
        await escribir(`INSERT INTO \`${tabla}\` (${columnas}) VALUES (${valores});\n`);
      }
      filasTabla += filas.length;
      if (filas.length < PAGINA) break;
    }
    totalFilas += filasTabla;
    if (filasTabla) await escribir('\n');
    console.log(`  ${tabla}: ${filasTabla} fila(s)`);
  }

  // Las vistas van al final: dependen de las tablas. Se quita el DEFINER,
  // que en otra base (u otro usuario de Aiven) haría fallar la restauración.
  for (const vista of vistas) {
    const [[ddl]] = await conn.query(`SHOW CREATE VIEW \`${vista}\``);
    const sinDefiner = ddl['Create View'].replace(/DEFINER=`[^`]+`@`[^`]+`\s*/, '');
    await escribir(`DROP VIEW IF EXISTS \`${vista}\`;\n${sinDefiner};\n\n`);
  }

  await escribir('SET FOREIGN_KEY_CHECKS = 1;\n');
  await new Promise((ok, mal) => {
    archivo.on('finish', ok);
    archivo.on('error', mal);
    gz.end();
  });
  // Recién completo se le pone el nombre final: un respaldo cortado a la
  // mitad nunca queda con cara de respaldo bueno.
  fs.renameSync(parcial, destino);
  await conn.end();

  const mb = (fs.statSync(destino).size / 1024 / 1024).toFixed(2);
  console.log(`\n${tablas.length} tablas, ${vistas.length} vistas, ${totalFilas} filas → ${destino} (${mb} MB)`);

  if (RETENER_DIAS) {
    const limite = Date.now() - RETENER_DIAS * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(DIR)) {
      if (!f.startsWith(`${process.env.DB_NAME}-`) || !f.endsWith('.sql.gz')) continue;
      const ruta = path.join(DIR, f);
      if (ruta !== destino && fs.statSync(ruta).mtimeMs < limite) {
        fs.unlinkSync(ruta);
        console.log(`  borrado por antigüedad: ${f}`);
      }
    }
  }
})().catch((err) => {
  console.error('Respaldo fallido:', err.message);
  process.exit(1);
});
