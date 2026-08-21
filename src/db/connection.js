const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:            process.env.DB_HOST,
  port:            process.env.DB_PORT,
  user:            process.env.DB_USER,
  password:        process.env.DB_PASSWORD,
  database:        process.env.DB_NAME,
  // El servidor MySQL (Aiven) corre en UTC: CURRENT_TIMESTAMP guarda hora UTC.
  // Sin esto, mysql2 interpretaba ese DATETIME como si fuera hora de Santiago y
  // devolvía un Date corrido +4h; el front después restaba las 4 al formatear,
  // así que una edición de las 11:05 se mostraba como 15:05.
  timezone: 'Z',
  // fecha_incidente es DATE (un día, sin hora): convertirlo a Date lo ancla a
  // medianoche UTC y en Chile se ve como el día anterior. Como string viaja tal
  // cual ('2026-07-11') y el DatePipe de Angular lo interpreta en local.
  dateStrings: ['DATE'],
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 10000,
  queueLimit: 20,
});

module.exports = pool;