const pool = require('../db/connection');

// Bandeja de notificaciones dentro de la app (la campana de la barra superior).
//
// Hasta ahora el sistema era 100% "pull": todo quedaba registrado en la
// bitácora, pero nadie se enteraba de nada si no entraba a mirar. Un paso con
// plazo de 24 horas asignado a Inspectoría podía vencer sin que su responsable
// supiera que existía.
//
// Este es el único canal por ahora. Correo/SMS/push vendrán después: por eso
// todo pasa por `crear()` y por `destinatariosDePaso()`, que son el punto donde
// se enganchará el envío externo sin tener que volver a tocar el controller.
//
// Regla general: una notificación NUNCA rompe la operación que la generó.
// Si el INSERT falla, se loguea y se sigue — que no se avise de un paso es malo,
// pero que no se pueda completar un protocolo porque falló el aviso es peor.

/**
 * Usuarios que deben recibir el aviso de un paso: los que tienen alguno de los
 * roles pedidos en el grafo congelado, más el responsable asignado a mano si lo
 * hay.
 *
 * Se consulta el rol y no una lista de usuarios guardada, porque el grafo
 * asigna roles ("Inspectoría"), no personas: quien tenga ese rol hoy es quien
 * tiene que enterarse, aunque haya entrado al colegio después de activarse el
 * protocolo.
 *
 * @param {object} ejecutor conn de la transacción, o el pool
 * @param {number} id_activado_paso
 * @param {string[]} tipos tipos de participación a incluir
 * @returns {Promise<number[]>} ids de usuario, sin repetir
 */
const destinatariosDePaso = async (ejecutor, id_activado_paso, tipos = ['ejecutor']) => {
  const [rows] = await ejecutor.query(
    `SELECT DISTINCT u.id_usuario
     FROM PROTOCOLO_ACTIVADO_PASO_ROL pr
     JOIN USUARIO_ROLES ur ON ur.rol_id = pr.rol_id
       AND (ur.expira_at IS NULL OR ur.expira_at > NOW())
     JOIN USUARIO u ON u.id_usuario = ur.id_usuario AND u.activo = 1
     JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pr.id_activado_paso
     -- El rol puede ser global (id_establecimiento NULL) y estar asignado a
     -- gente de varios colegios: sin este filtro, un paso de un colegio le
     -- llegaría a los usuarios de todos los demás.
     WHERE pr.id_activado_paso = ?
       AND pr.tipo_participacion IN (?)
       AND u.id_establecimiento = p.id_establecimiento`,
    [id_activado_paso, tipos]
  );

  const [[paso]] = await ejecutor.query(
    'SELECT id_usuario_responsable FROM PROTOCOLO_ACTIVADO_PASO WHERE id_activado_paso = ?',
    [id_activado_paso]
  );

  const ids = rows.map((r) => r.id_usuario);
  if (paso?.id_usuario_responsable) ids.push(paso.id_usuario_responsable);
  return [...new Set(ids)];
};

/**
 * Guarda una notificación por destinatario.
 *
 * @param {object} ejecutor conn de la transacción, o el pool
 * @param {object} datos
 * @param {number[]} datos.usuarios destinatarios
 * @param {number} datos.id_establecimiento
 * @param {string} datos.tipo
 * @param {string} datos.titulo
 * @param {string} [datos.mensaje]
 * @param {number} [datos.id_protocolo_activado] arma la url del caso
 * @param {number} [datos.id_activado_paso]
 * @param {number} [datos.excepto] no notificar a quien hizo la acción: ya lo sabe
 */
const crear = async (ejecutor, {
  usuarios,
  id_establecimiento,
  tipo,
  titulo,
  mensaje = null,
  id_protocolo_activado = null,
  id_activado_paso = null,
  excepto = null,
}) => {
  const destinatarios = [...new Set(usuarios ?? [])].filter((id) => id && id !== excepto);
  if (destinatarios.length === 0) return 0;

  // La url se arma acá y no en el frontend porque es lo que hace clickeable la
  // notificación: el día que exista el correo, el mismo string sirve de enlace.
  const url = id_protocolo_activado ? `/protocolos-activados/${id_protocolo_activado}` : null;

  try {
    await ejecutor.query(
      `INSERT INTO NOTIFICACION
         (id_usuario, id_establecimiento, tipo, titulo, mensaje, url,
          id_protocolo_activado, id_activado_paso, leida, fecha)
       VALUES ?`,
      [destinatarios.map((id_usuario) => [
        id_usuario, id_establecimiento, tipo, titulo, mensaje, url,
        id_protocolo_activado, id_activado_paso, 0, new Date(),
      ])]
    );
    return destinatarios.length;
  } catch (err) {
    console.error('No se pudo crear la notificación:', err.code, err.sqlMessage);
    return 0;
  }
};

/**
 * Atajo para el caso más común: un paso acaba de quedar en curso y hay que
 * avisarle a quien le toca trabajarlo.
 *
 * Un paso de aprobación se le avisa al aprobador; el resto, al ejecutor. Los
 * roles 'notificado' se enteran igual, que para eso están.
 */
const avisarPasoEnCurso = async (ejecutor, { activado, paso, excepto = null }) => {
  const tipos = paso.tipo_paso === 'aprobacion'
    ? ['ejecutor', 'aprobador', 'notificado']
    : ['ejecutor', 'notificado'];
  const usuarios = await destinatariosDePaso(ejecutor, paso.id_activado_paso, tipos);
  return crear(ejecutor, {
    usuarios,
    id_establecimiento: activado.id_establecimiento,
    tipo: 'paso_en_curso',
    titulo: `Te toca: ${paso.nombre}`,
    mensaje: `Protocolo "${activado.nombre ?? 'activado'}"` +
      (paso.fecha_limite ? ` · vence el ${new Date(paso.fecha_limite).toLocaleString('es-CL')}` : ''),
    id_protocolo_activado: activado.id_protocolo_activado,
    id_activado_paso: paso.id_activado_paso,
    excepto,
  });
};

module.exports = { destinatariosDePaso, crear, avisarPasoEnCurso };
