const pool = require('../db/connection');

// Establecimientos con el acceso suspendido desde Geo (acceso_bloqueado = 1).
//
// El login ya los rechaza, pero un token emitido antes de suspender sigue
// sirviendo hasta que expira (1 día). verifyToken lo revisa en cada petición,
// y consultar la BD cada vez costaría ~150 ms contra Aiven: por eso se guarda
// el conjunto en memoria y se recarga cada minuto. cambiarAcceso lo invalida
// al momento, así que en este proceso el corte es inmediato; el TTL solo cubre
// cambios hechos por fuera (un UPDATE a mano, otro proceso).
const TTL_MS = 60 * 1000;

let bloqueados = null;
let cargadoEn = 0;
let cargando = null;

const recargar = async () => {
  const [rows] = await pool.query(
    'SELECT id_establecimiento FROM ESTABLECIMIENTO WHERE acceso_bloqueado = 1'
  );
  bloqueados = new Set(rows.map((r) => r.id_establecimiento));
  cargadoEn = Date.now();
};

const estaBloqueado = async (idEstablecimiento) => {
  if (!idEstablecimiento) return false;
  if (!bloqueados || Date.now() - cargadoEn > TTL_MS) {
    // Peticiones simultáneas comparten la misma recarga.
    cargando ??= recargar().finally(() => { cargando = null; });
    await cargando;
  }
  return bloqueados.has(Number(idEstablecimiento));
};

const invalidarAccesoBloqueado = () => { bloqueados = null; };

module.exports = { estaBloqueado, invalidarAccesoBloqueado };
