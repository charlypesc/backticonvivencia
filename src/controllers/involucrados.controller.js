// Involucrados de un caso y el cumplimiento de los pasos que les tocan.
//
// Un caso se instruye CONTRA alguien y A FAVOR de alguien. Hasta la fase 12 el
// protocolo corría una sola vez para todos, pero el debido proceso es
// individual: si hay dos estudiantes señalados y uno apela, el otro no; cada
// apoderado se notifica por separado y cada plazo corre por su cuenta.
//
// Dos ideas sostienen este archivo:
//
//  1. El involucrado se congela con su nombre al incorporarlo. El expediente se
//     conserva 24 meses y el estudiante puede egresar; un expediente cuyo texto
//     depende de un join vivo no acredita nada. Es el mismo criterio con el que
//     el caso ya congela `nombre_protocolo` y el grafo completo.
//
//  2. Un paso que alcanza a tres personas sigue siendo UN nodo del grafo. Lo
//     que se multiplica son las filas de PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO.
//     Materializarlo como tres nodos rompería el motor, que es de un solo token
//     (`id_paso_actual` es uno solo): el primero en completarse arrastraría el
//     caso al paso siguiente dejando a los otros dos sin hacer.
const pool = require('../db/connection');
const { ROLES_INVOLUCRADO, TIPOS_PERSONA, MEDIOS_ACUSE } = require('../utils/flujoProtocolo');

const buscarActivado = async (id, id_establecimiento) => {
  const [rows] = await pool.query(
    `SELECT pa.*, COALESCE(pe.nombre, cp.nombre) AS nombre
     FROM PROTOCOLO_ACTIVADO pa
     JOIN PROTOCOLO_ESTABLECIMIENTO pe ON pa.id_protocolo_establecimiento = pe.id_protocolo_establecimiento
     LEFT JOIN CATALOGO_PROTOCOLOS_GENERICOS cp ON pe.id_protocolo = cp.id_protocolo
     WHERE pa.id_establecimiento = ? AND pa.id_protocolo_activado = ?`,
    [id_establecimiento, id]
  );
  return rows[0] ?? null;
};

const registrarEvento = (conn, { id_protocolo_activado, id_establecimiento, paso = null, tipo, descripcion, id_usuario }) =>
  conn.query(
    `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
       (id_protocolo_activado, id_establecimiento, id_activado_paso, tipo_evento, descripcion, id_usuario, fecha)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [id_protocolo_activado, id_establecimiento, paso, tipo, descripcion, id_usuario]
  );

/**
 * Crea las filas de cumplimiento que le corresponden a un involucrado.
 *
 * Solo sobre pasos **no cumplidos**: un involucrado incorporado a mitad del
 * caso no puede nacer con una notificación atrasada de un paso que se cerró
 * cuando él todavía no figuraba. `INSERT IGNORE` porque el índice único
 * (paso, involucrado) es la garantía de que no se duplica al cambiar de rol
 * dos veces.
 */
const materializarPasos = (conn, { id_protocolo_activado, id_involucrado, rol }) =>
  conn.query(
    `INSERT IGNORE INTO PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO (id_activado_paso, id_involucrado)
     SELECT p.id_activado_paso, ?
     FROM PROTOCOLO_ACTIVADO_PASO p
     WHERE p.id_protocolo_activado = ?
       AND p.estado IN ('pendiente', 'en_curso')
       AND (p.por_involucrado_rol = ? OR (p.por_involucrado_rol = 'todos' AND ? <> 'testigo'))`,
    [id_involucrado, id_protocolo_activado, rol, rol]
  );

const getByCaso = async (req, res) => {
  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });

    const [involucrados] = await pool.query(
      `SELECT i.*,
              (SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
               WHERE pi.id_involucrado = i.id_involucrado AND pi.estado = 'pendiente') AS pasos_pendientes,
              (SELECT COUNT(*) FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
               JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pi.id_activado_paso
               WHERE pi.id_involucrado = i.id_involucrado AND p.requiere_acuse = 1
                 AND pi.estado <> 'no_aplica' AND pi.fecha_acuse IS NULL) AS acuses_pendientes
       FROM PROTOCOLO_ACTIVADO_INVOLUCRADO i
       WHERE i.id_protocolo_activado = ?
       ORDER BY FIELD(i.rol, 'afectado','senalado','denunciante','testigo'), i.nombre`,
      [req.params.id]
    );
    res.json(involucrados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los involucrados' });
  }
};

/**
 * Incorpora un involucrado al caso, que es algo que pasa de verdad: en una
 * entrevista aparece un cuarto participante del que nadie sabía.
 */
const agregar = async (req, res) => {
  const { tipo_persona, id_estudiante, id_usuario, nombre, rut, rol } = req.body;

  if (!TIPOS_PERSONA.includes(tipo_persona))
    return res.status(400).json({ message: `tipo_persona debe ser uno de: ${TIPOS_PERSONA.join(', ')}.` });
  if (!ROLES_INVOLUCRADO.includes(rol))
    return res.status(400).json({ message: `rol debe ser uno de: ${ROLES_INVOLUCRADO.join(', ')}.` });

  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });
    if (activado.estado !== 'activo')
      return res.status(409).json({ message: `El protocolo está ${activado.estado}: ya no admite nuevos involucrados.` });

    // Los datos se copian de la ficha, no se piden: quien registra no tiene por
    // qué transcribir un RUT que el sistema ya tiene.
    let datos;
    if (tipo_persona === 'estudiante') {
      const [e] = await pool.query(
        `SELECT CONCAT(e.nombre, ' ', e.apellido) AS nombre, CONCAT(e.run, '-', e.dv) AS rut,
                c.nombre AS curso
         FROM ESTUDIANTE e LEFT JOIN CURSO c ON c.id_curso = e.id_curso
         WHERE e.id_estudiante = ? AND e.id_establecimiento = ?`,
        [id_estudiante, req.id_establecimiento]
      );
      if (e.length === 0) return res.status(404).json({ message: 'Estudiante no encontrado en este establecimiento' });
      datos = { id_estudiante, id_usuario: null, ...e[0] };
    } else if (tipo_persona === 'funcionario') {
      const [u] = await pool.query(
        'SELECT nombre FROM USUARIO WHERE id_usuario = ? AND id_establecimiento = ?',
        [id_usuario, req.id_establecimiento]
      );
      if (u.length === 0) return res.status(404).json({ message: 'Funcionario no encontrado en este establecimiento' });
      datos = { id_estudiante: null, id_usuario, nombre: u[0].nombre, rut: rut?.trim() || null, curso: null };
    } else {
      // Externo: un apoderado o un tercero. No hay tabla de apoderados en el
      // sistema, así que va por nombre y el RUT queda opcional.
      if (!nombre?.trim()) return res.status(400).json({ message: 'El nombre es requerido para un involucrado externo' });
      datos = { id_estudiante: null, id_usuario: null, nombre: nombre.trim(), rut: rut?.trim() || null, curso: null };
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        `INSERT INTO PROTOCOLO_ACTIVADO_INVOLUCRADO
           (id_protocolo_activado, id_establecimiento, tipo_persona, id_estudiante, id_usuario,
            nombre, rut, curso, rol, id_usuario_registro)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.params.id, req.id_establecimiento, tipo_persona, datos.id_estudiante, datos.id_usuario,
         datos.nombre, datos.rut, datos.curso, rol, req.user.id]
      );
      await materializarPasos(conn, {
        id_protocolo_activado: req.params.id, id_involucrado: r.insertId, rol,
      });
      await registrarEvento(conn, {
        id_protocolo_activado: req.params.id, id_establecimiento: req.id_establecimiento,
        tipo: 'involucrado_agregado', id_usuario: req.user.id,
        descripcion: `Se incorpora ${datos.nombre} como ${rol}`,
      });
      await conn.commit();
      res.status(201).json({ id_involucrado: r.insertId, message: 'Involucrado incorporado al caso' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Esta persona ya figura como involucrada en el caso.' });
    console.error(err);
    res.status(500).json({ message: 'Error al incorporar al involucrado' });
  }
};

/**
 * Cambia el rol de un involucrado: la investigación cambia lo que se sabía al
 * activar, y quien figuraba como testigo puede terminar señalado.
 *
 * Los pasos ya cumplidos no se tocan — son hechos, no configuración. Los
 * pendientes que dejan de corresponder se borran y aparecen los del rol nuevo.
 */
const cambiarRol = async (req, res) => {
  const { rol } = req.body;
  if (!ROLES_INVOLUCRADO.includes(rol))
    return res.status(400).json({ message: `rol debe ser uno de: ${ROLES_INVOLUCRADO.join(', ')}.` });

  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });

    const [inv] = await pool.query(
      'SELECT * FROM PROTOCOLO_ACTIVADO_INVOLUCRADO WHERE id_involucrado = ? AND id_protocolo_activado = ?',
      [req.params.id_involucrado, req.params.id]
    );
    if (inv.length === 0) return res.status(404).json({ message: 'Involucrado no encontrado en este caso' });
    if (inv[0].rol === rol) return res.json({ message: 'El involucrado ya tenía ese rol' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE PROTOCOLO_ACTIVADO_INVOLUCRADO SET rol = ? WHERE id_involucrado = ?', [
        rol, req.params.id_involucrado,
      ]);
      await conn.query(
        `DELETE pi FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
         JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pi.id_activado_paso
         WHERE pi.id_involucrado = ? AND pi.estado = 'pendiente'
           AND NOT (p.por_involucrado_rol = ? OR (p.por_involucrado_rol = 'todos' AND ? <> 'testigo'))`,
        [req.params.id_involucrado, rol, rol]
      );
      await materializarPasos(conn, {
        id_protocolo_activado: req.params.id, id_involucrado: req.params.id_involucrado, rol,
      });
      await registrarEvento(conn, {
        id_protocolo_activado: req.params.id, id_establecimiento: req.id_establecimiento,
        tipo: 'involucrado_editado', id_usuario: req.user.id,
        descripcion: `${inv[0].nombre}: rol ${inv[0].rol} → ${rol}`,
      });
      await conn.commit();
      res.json({ message: 'Rol actualizado' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al cambiar el rol del involucrado' });
  }
};

/**
 * Saca a alguien del caso. Solo mientras no se le haya hecho nada: una gestión
 * cumplida es un hecho ocurrido, y borrarlo sería borrar del expediente algo
 * que sí pasó. Para eso está cambiar el rol.
 */
const quitar = async (req, res) => {
  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });

    const [inv] = await pool.query(
      'SELECT * FROM PROTOCOLO_ACTIVADO_INVOLUCRADO WHERE id_involucrado = ? AND id_protocolo_activado = ?',
      [req.params.id_involucrado, req.params.id]
    );
    if (inv.length === 0) return res.status(404).json({ message: 'Involucrado no encontrado en este caso' });

    const [[{ c }]] = await pool.query(
      `SELECT COUNT(*) c FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO
       WHERE id_involucrado = ? AND estado <> 'pendiente'`,
      [req.params.id_involucrado]
    );
    if (c > 0)
      return res.status(409).json({
        message: `No se puede quitar a ${inv[0].nombre}: ya hay ${c} gestión(es) registradas sobre esta persona. Si su participación cambió, corrige el rol.`,
      });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Las filas pendientes se van con él por la cascada de la FK.
      await conn.query('DELETE FROM PROTOCOLO_ACTIVADO_INVOLUCRADO WHERE id_involucrado = ?', [
        req.params.id_involucrado,
      ]);
      await registrarEvento(conn, {
        id_protocolo_activado: req.params.id, id_establecimiento: req.id_establecimiento,
        tipo: 'involucrado_editado', id_usuario: req.user.id,
        descripcion: `Se quita del caso a ${inv[0].nombre} (${inv[0].rol})`,
      });
      await conn.commit();
      res.json({ message: 'Involucrado quitado del caso' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al quitar al involucrado' });
  }
};

/**
 * Registra lo que se hizo con una persona en un paso: la notificación, la
 * entrega del documento, la firma.
 *
 * `fecha_gestion` es la fecha real del hecho y puede ser anterior a hoy — la
 * entrevista fue el martes y se digita el jueves. `fecha_registro` la estampa
 * la BD. Sin esa separación el sistema informa como atrasado algo que se hizo
 * a tiempo, que es el error caro.
 *
 * Que falte el acuse NO bloquea nada (fase 12.3): se guarda igual y la pantalla
 * lo muestra en rojo. La exigencia aparece al cerrar el caso.
 */
const registrarGestion = async (req, res) => {
  const { estado, fecha_gestion, observacion, fecha_acuse, medio_acuse } = req.body;

  if (estado && !['pendiente', 'cumplido', 'no_aplica'].includes(estado))
    return res.status(400).json({ message: "estado debe ser 'pendiente', 'cumplido' o 'no_aplica'." });
  if (medio_acuse && !MEDIOS_ACUSE.includes(medio_acuse))
    return res.status(400).json({ message: `medio_acuse debe ser uno de: ${MEDIOS_ACUSE.join(', ')}.` });
  if (fecha_acuse && !medio_acuse)
    return res.status(400).json({ message: 'Si registras la firma, indica también por qué medio se obtuvo.' });

  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });

    const [filas] = await pool.query(
      `SELECT pi.*, i.nombre AS involucrado_nombre, p.nombre AS paso_nombre, p.id_activado_paso
       FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
       JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i ON i.id_involucrado = pi.id_involucrado
       JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pi.id_activado_paso
       WHERE pi.id_paso_involucrado = ? AND p.id_protocolo_activado = ?`,
      [req.params.id_paso_involucrado, req.params.id]
    );
    if (filas.length === 0)
      return res.status(404).json({ message: 'Gestión no encontrada en este caso' });
    const fila = filas[0];

    const nuevoEstado = estado ?? 'cumplido';
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO
         SET estado = ?,
             fecha_cumplido = CASE WHEN ? = 'pendiente' THEN NULL ELSE COALESCE(fecha_cumplido, NOW()) END,
             fecha_gestion = ?, observacion = ?,
             fecha_acuse = COALESCE(?, fecha_acuse), medio_acuse = COALESCE(?, medio_acuse),
             id_usuario = ?
         WHERE id_paso_involucrado = ?`,
        [nuevoEstado, nuevoEstado, fecha_gestion || null, observacion?.trim() || null,
         fecha_acuse || null, medio_acuse || null, req.user.id, req.params.id_paso_involucrado]
      );
      await registrarEvento(conn, {
        id_protocolo_activado: req.params.id, id_establecimiento: req.id_establecimiento,
        paso: fila.id_activado_paso, tipo: 'gestion_involucrado', id_usuario: req.user.id,
        descripcion:
          `'${fila.paso_nombre}' — ${fila.involucrado_nombre}: ${nuevoEstado}` +
          (fecha_gestion ? ` (gestión del ${fecha_gestion})` : '') +
          (fecha_acuse ? ` · firma ${medio_acuse}` : ''),
      });
      await conn.commit();
      res.json({ message: 'Gestión registrada' });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al registrar la gestión' });
  }
};

module.exports = { getByCaso, agregar, cambiarRol, quitar, registrarGestion };
