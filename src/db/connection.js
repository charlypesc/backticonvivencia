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
  // Abrir una conexión nueva contra Aiven cuesta ~850 ms (TCP + TLS +
  // handshake de MySQL), casi seis veces lo que cuesta una consulta ya
  // conectada (~150 ms). Con el default de mysql2 (idleTimeout 60 s) el pool
  // cerraba todas las conexiones tras un minuto sin actividad, que es
  // exactamente lo que tarda alguien en llenar el formulario de un registro:
  // el guardado siguiente pagaba el handshake completo antes del primer
  // INSERT. Por eso los guardados se sentían lentos de forma intermitente.
  //
  // 30 minutos está muy por debajo del wait_timeout del servidor (8 h), así
  // que el que corta siempre es el pool y nunca nos toca reusar una conexión
  // que Aiven ya cerró por su cuenta.
  idleTimeout: 30 * 60 * 1000,
  // Cuántas conexiones se mantienen calientes al quedar libres. Se deja en 4 y
  // no en las 10 del límite porque el servidor admite 76 conexiones en total y
  // las comparten todos los entornos (local, Render, scripts sueltos):
  // acaparar diez ociosas por proceso deja sin cupo al resto.
  maxIdle: 4,
});

module.exports = pool;