// Quién ve un protocolo activado completo.
//
// No lo decide un permiso de rol, sino cada caso: la lista
// PROTOCOLO_ACTIVADO_ACCESO, que se administra desde el propio caso ("¿Quién
// puede ver este protocolo completo?"). Quien activa un caso entra solo.
//
// Tres roles ven siempre todos los casos sin estar en la lista, porque
// supervisan el procedimiento y no puede quedar un caso sin nadie que lo vea:
// ADMIN, DIRECTOR y ENCARGADO (coordinador de convivencia).
//
// El resto entra por la lista, o porque le asignaron una tarjeta (un paso) o el
// relato de una persona, y en ese caso ve solo eso.
//
// Fundamento: la investigación se rige por la confidencialidad (Ley 21.809,
// art. 16 E letra g) y los colegios deben proteger los datos de niños, niñas y
// adolescentes (Ley 21.719, art. 16 quáter).
const { Permiso } = require('../constants/permisos');

const ROLES_SUPERVISION = ['ADMIN', 'DIRECTOR', 'ENCARGADO'];

const esSupervisor = (req) => (req.user?.roles ?? []).some((r) => ROLES_SUPERVISION.includes(r));

/** ¿Está en la lista de acceso del caso? (sin contar la supervisión por rol). */
const estaEnLaLista = async (db, id_protocolo_activado, id_usuario) => {
  const [filas] = await db.query(
    'SELECT 1 FROM PROTOCOLO_ACTIVADO_ACCESO WHERE id_protocolo_activado = ? AND id_usuario = ?',
    [id_protocolo_activado, id_usuario]
  );
  return filas.length > 0;
};

/** ¿Ve el caso completo? Supervisión por rol o estar en la lista. */
const tieneAccesoCompleto = async (db, req, id_protocolo_activado) =>
  esSupervisor(req) || estaEnLaLista(db, id_protocolo_activado, req.user.id);

/**
 * Lo que da estar en la lista de acceso de un caso, SOLO dentro de ese caso:
 * verlo, trabajar sus pasos y relatos, dejar notas, administrar involucrados,
 * encargar tarjetas, ver la bitácora y exportar el expediente.
 *
 * No da lo que es una decisión del rol, que sigue siendo del rol: aprobar un
 * paso (lo firma la dirección), cerrar o anular el caso, ni eliminarlo.
 */
const PERMISOS_DEL_CASO = [
  Permiso.ProtocoloActivadoVer,
  Permiso.ProtocoloActivadoEditar,
  Permiso.ProtocoloActivadoCompletarPaso,
  Permiso.ProtocoloActivadoOmitirPaso,
  Permiso.ProtocoloActivadoReasignarPaso,
  Permiso.ProtocoloActivadoVerBitacora,
  Permiso.ExpedienteExportar,
];

/**
 * Los permisos que el caso le suma a quien mira, además de los de su rol.
 *
 *  - En la lista de acceso: PERMISOS_DEL_CASO.
 *  - Con una tarjeta o un relato encargado: solo verlo. Lo que puede hacer ahí
 *    ya lo resuelve cada endpoint por el encargo (permisoOResponsable, el
 *    alcance de los relatos).
 *
 * La supervisión no necesita nada: lo ve todo con los permisos de su rol.
 */
const permisosDelCaso = async (db, req, id_protocolo_activado) => {
  if (esSupervisor(req)) return [];
  const [[caso]] = await db.query(
    'SELECT 1 AS ok FROM PROTOCOLO_ACTIVADO WHERE id_protocolo_activado = ? AND id_establecimiento = ?',
    [id_protocolo_activado, req.id_establecimiento]
  );
  if (!caso) return [];
  if (await estaEnLaLista(db, id_protocolo_activado, req.user.id)) return PERMISOS_DEL_CASO;
  const [encargos] = await db.query(
    `SELECT 1 FROM PROTOCOLO_ACTIVADO_PASO p
      WHERE p.id_protocolo_activado = ? AND p.id_usuario_responsable = ?
     UNION ALL
     SELECT 1 FROM PROTOCOLO_ACTIVADO_RELATO_DECISION d
       JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = d.id_activado_paso
      WHERE p.id_protocolo_activado = ? AND d.id_usuario_responsable = ?
     LIMIT 1`,
    [id_protocolo_activado, req.user.id, id_protocolo_activado, req.user.id]
  );
  return encargos.length ? [Permiso.ProtocoloActivadoVer] : [];
};

/**
 * ¿Tiene algún caso del colegio, por lista de acceso o por encargo? Es lo que
 * le abre "Protocolos activados" en el menú aunque su rol no lo tenga: ahí ve
 * solo esos casos (el listado ya filtra por participación).
 */
const participaEnAlgunCaso = async (db, id_usuario) => {
  const [filas] = await db.query(
    `SELECT 1 FROM PROTOCOLO_ACTIVADO_ACCESO a
       JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = a.id_protocolo_activado
      WHERE a.id_usuario = ? AND pa.estado <> 'anulado'
     UNION ALL
     SELECT 1 FROM PROTOCOLO_ACTIVADO_PASO p
       JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = p.id_protocolo_activado
      WHERE p.id_usuario_responsable = ? AND pa.estado <> 'anulado'
     UNION ALL
     SELECT 1 FROM PROTOCOLO_ACTIVADO_RELATO_DECISION d
       JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = d.id_activado_paso
       JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = p.id_protocolo_activado
      WHERE d.id_usuario_responsable = ? AND pa.estado <> 'anulado'
     LIMIT 1`,
    [id_usuario, id_usuario, id_usuario]
  );
  return filas.length > 0;
};

module.exports = {
  ROLES_SUPERVISION, PERMISOS_DEL_CASO,
  esSupervisor, estaEnLaLista, tieneAccesoCompleto, permisosDelCaso, participaEnAlgunCaso,
};
