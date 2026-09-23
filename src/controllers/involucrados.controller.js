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
const {
  ROLES_INVOLUCRADO, TIPOS_PERSONA, MEDIOS_NOTIFICACION, SQL_ROL_ALCANZA_PASO,
} = require('../utils/flujoProtocolo');
const { comprimirArchivo } = require('../utils/comprimirArchivo');
const { etiquetaDe } = require('../utils/etiquetas');
const { construirActaNotificacionPdf } = require('../services/pdf/actaNotificacion.pdf');
const { enviarPdf } = require('../services/pdf/comun');

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
       AND ${SQL_ROL_ALCANZA_PASO}`,
    [id_involucrado, id_protocolo_activado, rol, rol]
  );

/**
 * Refleja en el registro de origen lo que se cambió en los involucrados del
 * caso.
 *
 * El caso nace copiando REGISTRO_ESTUDIANTE (ver `activar` en
 * protocolosActivados.controller), pero después vivía suelto: quien descubría
 * en una entrevista que había un cuarto participante, o que el testigo era en
 * realidad el señalado, lo corregía en el caso y el registro seguía diciendo lo
 * de antes. Dos pantallas del mismo hecho contando cosas distintas.
 *
 * Solo se sincronizan los involucrados **estudiante**: REGISTRO_ESTUDIANTE no
 * tiene dónde guardar a un funcionario ni a un externo. Los roles son los
 * mismos cuatro del enum de la columna, así que el valor viaja tal cual.
 *
 * El nombre/RUT congelado del involucrado NO se toca en el registro: el
 * registro apunta al estudiante por id y lee su ficha viva; congelar es cosa
 * del expediente del caso.
 */
const sincronizarRolEnRegistro = async (conn, { id_registro, id_estudiante, rol }) => {
  if (!id_registro || !id_estudiante) return;
  await conn.query(
    `INSERT INTO REGISTRO_ESTUDIANTE (id_registro, id_estudiante, rol_en_incidente)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE rol_en_incidente = VALUES(rol_en_incidente)`,
    [id_registro, id_estudiante, rol]
  );
};

/**
 * Saca al estudiante del registro cuando dejó de figurar en todos los casos que
 * cuelgan de ese registro.
 *
 * No alcanza con mirar el caso actual: un mismo registro puede tener varios
 * protocolos activados (maltrato y vulneración, por ejemplo), y borrar del
 * registro a alguien que sigue siendo señalado en el otro caso dejaría al
 * expediente sin el participante que aún se está tramitando. Un protocolo
 * anulado no cuenta: ese caso quedó sin tramitar.
 *
 * El mismo estudiante puede figurar dos veces en un caso con roles distintos
 * (la agresión mutua: es afectado y señalado a la vez); por eso se excluye solo
 * la fila que se está quitando y, si queda otra, el registro se queda con el
 * rol que sobrevive en vez de perder al participante.
 */
const sincronizarBajaEnRegistro = async (conn, { id_registro, id_estudiante, id_involucrado }) => {
  if (!id_registro || !id_estudiante) return;
  const [otros] = await conn.query(
    `SELECT i.rol
     FROM PROTOCOLO_ACTIVADO_INVOLUCRADO i
     JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = i.id_protocolo_activado
     WHERE pa.id_registro = ? AND pa.estado <> 'anulado'
       AND i.id_estudiante = ? AND i.id_involucrado <> ?
     ORDER BY FIELD(i.rol, 'senalado','afectado','denunciante','testigo')
     LIMIT 1`,
    [id_registro, id_estudiante, id_involucrado]
  );
  if (otros.length > 0)
    return sincronizarRolEnRegistro(conn, { id_registro, id_estudiante, rol: otros[0].rol });

  await conn.query('DELETE FROM REGISTRO_ESTUDIANTE WHERE id_registro = ? AND id_estudiante = ?', [
    id_registro, id_estudiante,
  ]);
};

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
               WHERE pi.id_involucrado = i.id_involucrado AND p.requiere_notificacion = 1
                 AND pi.estado <> 'no_aplica' AND pi.fecha_notificacion IS NULL) AS notificaciones_pendientes
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
    } else if (tipo_persona === 'funcionario' && id_usuario == null) {
      // Un funcionario sin cuenta en el sistema (un reemplazante, un asistente
      // que nunca entró a la app). Se escribe a mano y queda igual como
      // funcionario del caso, no como externo: el rol en el establecimiento es
      // el que importa para el protocolo.
      if (!nombre?.trim())
        return res.status(400).json({ message: 'El nombre es requerido para un funcionario que no está en la lista' });
      datos = { id_estudiante: null, id_usuario: null, nombre: nombre.trim(), rut: rut?.trim() || null, curso: null };
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
      await sincronizarRolEnRegistro(conn, {
        id_registro: activado.id_registro, id_estudiante: datos.id_estudiante, rol,
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
           AND NOT ${SQL_ROL_ALCANZA_PASO}`,
        [req.params.id_involucrado, rol, rol]
      );
      await materializarPasos(conn, {
        id_protocolo_activado: req.params.id, id_involucrado: req.params.id_involucrado, rol,
      });
      await sincronizarRolEnRegistro(conn, {
        id_registro: activado.id_registro, id_estudiante: inv[0].id_estudiante, rol,
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
      // Después del DELETE: la consulta que decide si sigue figurando en algún
      // caso del registro no debe contar la fila que se acaba de quitar.
      await sincronizarBajaEnRegistro(conn, {
        id_registro: activado.id_registro,
        id_estudiante: inv[0].id_estudiante,
        id_involucrado: req.params.id_involucrado,
      });
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
 * Registra lo que se hizo con una persona en un paso: la notificación o la
 * entrega del documento.
 *
 * `fecha_gestion` es la fecha real del hecho y puede ser anterior a hoy — la
 * entrevista fue el martes y se digita el jueves. `fecha_registro` la estampa
 * la BD. Sin esa separación el sistema informa como atrasado algo que se hizo
 * a tiempo, que es el error caro.
 *
 * No se le pide firma a la persona: lo que se registra es que se le notificó,
 * cuándo y por qué vía. Que falte esa constancia NO bloquea nada (fase 12.3):
 * se guarda igual y la pantalla lo muestra en rojo. La exigencia aparece al
 * cerrar el caso.
 */
const registrarGestion = async (req, res) => {
  const { estado, fecha_gestion, observacion, fecha_notificacion, medio_notificacion } = req.body;

  if (estado && !['pendiente', 'cumplido', 'no_aplica'].includes(estado))
    return res.status(400).json({ message: "estado debe ser 'pendiente', 'cumplido' o 'no_aplica'." });
  if (medio_notificacion && !MEDIOS_NOTIFICACION.includes(medio_notificacion))
    return res.status(400).json({ message: `medio_notificacion debe ser uno de: ${MEDIOS_NOTIFICACION.join(', ')}.` });
  if (fecha_notificacion && !medio_notificacion)
    return res.status(400).json({ message: 'Si registras la notificación, indica también por qué vía se hizo.' });

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
             fecha_notificacion = COALESCE(?, fecha_notificacion),
             medio_notificacion = COALESCE(?, medio_notificacion),
             id_usuario = ?
         WHERE id_paso_involucrado = ?`,
        [nuevoEstado, nuevoEstado, fecha_gestion || null, observacion?.trim() || null,
         fecha_notificacion || null, medio_notificacion || null, req.user.id, req.params.id_paso_involucrado]
      );
      await registrarEvento(conn, {
        id_protocolo_activado: req.params.id, id_establecimiento: req.id_establecimiento,
        paso: fila.id_activado_paso, tipo: 'gestion_involucrado', id_usuario: req.user.id,
        descripcion:
          `${fila.paso_nombre} — ${fila.involucrado_nombre}: ${nuevoEstado}` +
          (fecha_gestion ? ` (gestión del ${fecha_gestion})` : '') +
          (fecha_notificacion ? ` · notificada por ${medio_notificacion}` : ''),
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

/**
 * Busca una gestión del caso. Se usa antes de tocar su acta: el id del paso
 * involucrado no basta como llave, tiene que pertenecer a este caso y a este
 * establecimiento.
 */
// El establecimiento es obligatorio y va en el WHERE: sin él, con los ids de un
// caso de otro colegio se podía bajar su acta firmada (nombre, RUT y firma de
// un estudiante ajeno). Se filtra acá y no en cada llamador para que ninguno
// pueda olvidarlo.
const buscarGestion = async (id_caso, id_paso_involucrado, id_establecimiento) => {
  const [filas] = await pool.query(
    `SELECT pi.id_paso_involucrado, pi.id_activado_paso, i.nombre AS involucrado_nombre,
            p.nombre AS paso_nombre
     FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
     JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i ON i.id_involucrado = pi.id_involucrado
     JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pi.id_activado_paso
     JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = p.id_protocolo_activado
     WHERE pi.id_paso_involucrado = ? AND p.id_protocolo_activado = ?
       AND pa.id_establecimiento = ?`,
    [id_paso_involucrado, id_caso, id_establecimiento]
  );
  return filas[0] ?? null;
};

/**
 * PUT /:id/gestiones/:id_paso_involucrado/acta — el acta de notificación
 * firmada, escaneada o fotografiada.
 *
 * La fecha y la vía prueban que se notificó según el sistema; el acta firmada
 * es la prueba material, y es la que se exhibe ante la Superintendencia o el
 * apoderado que dice que nunca se enteró. Una sola por gestión: si se vuelve a
 * subir, reemplaza (ON DUPLICATE KEY), porque lo que vale es la última copia
 * legible, no el historial de escaneos.
 */
const adjuntarActaFirmada = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No se recibió archivo' });

  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });

    const gestion = await buscarGestion(req.params.id, req.params.id_paso_involucrado, req.id_establecimiento);
    if (!gestion) return res.status(404).json({ message: 'Gestión no encontrada en este caso' });

    // Mismo criterio que el resto de los adjuntos: entra cualquier foto pesada
    // y el sistema la baja de peso, en vez de rechazarla y hacer que el
    // usuario pelee con la cámara.
    const archivo = await comprimirArchivo(req.file);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO_ARCHIVO
           (id_paso_involucrado, nombre_archivo, mime_type, peso_bytes, contenido, fecha_subida)
         VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           nombre_archivo = VALUES(nombre_archivo), mime_type = VALUES(mime_type),
           peso_bytes = VALUES(peso_bytes), contenido = VALUES(contenido),
           fecha_subida = NOW()`,
        [req.params.id_paso_involucrado, archivo.originalname, archivo.mimetype,
         archivo.size, archivo.buffer]
      );
      await registrarEvento(conn, {
        id_protocolo_activado: req.params.id, id_establecimiento: req.id_establecimiento,
        paso: gestion.id_activado_paso, tipo: 'gestion_involucrado', id_usuario: req.user.id,
        descripcion: `${gestion.paso_nombre} — ${gestion.involucrado_nombre}: se adjuntó el acta firmada`,
      });
      await conn.commit();
      res.json({
        message: 'Acta firmada adjuntada',
        bytes: archivo.size,
        bytes_originales: archivo.bytes_originales,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al adjuntar el acta firmada' });
  }
};

// GET /:id/gestiones/:id_paso_involucrado/acta — se devuelve inline: quien la
// abre normalmente la quiere mirar o imprimir, no bajarla otra vez.
const descargarActaFirmada = async (req, res) => {
  try {
    const gestion = await buscarGestion(req.params.id, req.params.id_paso_involucrado, req.id_establecimiento);
    if (!gestion) return res.status(404).json({ message: 'Gestión no encontrada en este caso' });

    const [[archivo]] = await pool.query(
      `SELECT nombre_archivo, mime_type, contenido
       FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO_ARCHIVO WHERE id_paso_involucrado = ?`,
      [req.params.id_paso_involucrado]
    );
    if (!archivo) return res.status(404).json({ message: 'Esta gestión no tiene acta firmada' });

    res.setHeader('Content-Type', archivo.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${archivo.nombre_archivo}"`);
    res.send(archivo.contenido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al descargar el acta firmada' });
  }
};

/** "7BasicoA" → "7 Basico A". Mismo formato que el pipe cursoNombre del front. */
const formatearNombreCurso = (nombre) => {
  if (!nombre) return '';
  const m = String(nombre).match(/^(\d+)(Basico|Medio)([A-Z])$/);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : nombre;
};

/**
 * El texto del plazo de reconsideración. En expulsión y cancelación de
 * matrícula el plazo lo fija la ley (art. 6 letra d) del DFL 2): 15 días
 * hábiles ante el Director. En el resto lo fija el reglamento interno, que el
 * sistema todavía no guarda: por eso el número lo elige quien emite el acta.
 */
const textoPlazo = (dias, esExpulsion) => {
  const cuantos = `${dias} día${dias === 1 ? '' : 's'} hábil${dias === 1 ? '' : 'es'}`;
  return esExpulsion
    ? `${cuantos} desde esta notificación para pedir por escrito la reconsideración de la medida ` +
        'ante el Director, quien resolverá previa consulta al Consejo de Profesores ' +
        '(art. 6 letra d) del DFL 2 de 2009).'
    : `${cuantos} desde esta notificación para pedir por escrito la reconsideración de la medida ` +
        'ante la Dirección del establecimiento, según el Reglamento Interno de Convivencia Escolar.';
};

// GET /:id/gestiones/:id_paso_involucrado/acta-notificacion?plazo_dias=5
//
// El acta EN BLANCO para imprimir y firmar (la firmada es `/acta`). Todo lo que
// dice lo junta el servidor —persona, medidas, caso, quién notifica—; del
// cliente solo viene el plazo, que es la única decisión de quien la emite.
const generarActaNotificacion = async (req, res) => {
  try {
    const activado = await buscarActivado(req.params.id, req.id_establecimiento);
    if (!activado) return res.status(404).json({ message: 'Protocolo activado no encontrado' });

    const [[g]] = await pool.query(
      `SELECT pi.id_paso_involucrado, i.id_involucrado, i.nombre, i.rut, i.curso, i.rol,
              p.nombre AS paso_nombre, p.tipo_paso
       FROM PROTOCOLO_ACTIVADO_PASO_INVOLUCRADO pi
       JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i ON i.id_involucrado = pi.id_involucrado
       JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = pi.id_activado_paso
       WHERE pi.id_paso_involucrado = ? AND p.id_protocolo_activado = ?`,
      [req.params.id_paso_involucrado, req.params.id]
    );
    if (!g) return res.status(404).json({ message: 'Gestión no encontrada en este caso' });

    const [[registro]] = await pool.query(
      `SELECT r.asunto, r.fecha_incidente, e.nombre AS establecimiento_nombre, e.rbd
       FROM REGISTRO_CONVIVENCIA r
       JOIN ESTABLECIMIENTO e ON e.id_establecimiento = r.id_establecimiento
       WHERE r.id_registro = ?`,
      [activado.id_registro]
    );

    // Solo las medidas de ESTA persona: el acta se le entrega a ella y no
    // puede traer lo resuelto sobre otro involucrado. Por id cuando la medida
    // lo trae; las anteriores a esa columna, por el nombre del estudiante.
    const [medidas] = await pool.query(
      `SELECT md.descripcion, md.tipo_medida, md.fecha_aplicacion, md.id_involucrado,
              TRIM(CONCAT(COALESCE(es.nombre, ''), ' ', COALESCE(es.apellido, ''))) AS estudiante
       FROM MEDIDA_DISCIPLINARIA md
       LEFT JOIN ESTUDIANTE es ON es.id_estudiante = md.id_estudiante
       WHERE md.id_registro = ?
       ORDER BY md.fecha_aplicacion, md.id_medida`,
      [activado.id_registro]
    );
    const nombre = String(g.nombre ?? '').trim().toLowerCase();
    const suyas = medidas.filter((m) =>
      m.id_involucrado ? m.id_involucrado === g.id_involucrado : m.estudiante.toLowerCase() === nombre
    );

    const [[informe]] = await pool.query(
      'SELECT 1 AS hay FROM INFORME_EXPULSION WHERE id_protocolo_activado = ? AND id_establecimiento = ?',
      [req.params.id, req.id_establecimiento]
    );
    const esExpulsion = !!informe;
    // 15 días por ley en expulsión; 5 como punto de partida en el resto.
    const pedido = parseInt(req.query.plazo_dias, 10);
    const dias = Number.isInteger(pedido) && pedido >= 1 && pedido <= 60 ? pedido : esExpulsion ? 15 : 5;

    // Quien notifica es quien emite el acta: sale de la sesión, no del cliente.
    // Con el cargo, porque importa en qué calidad actuó.
    const [[notificador]] = await pool.query(
      `SELECT u.nombre, u.correo,
              (SELECT ro.nombre FROM USUARIO_ROLES uro
                 JOIN ROLES ro ON ro.rol_id = uro.rol_id AND ro.activo = TRUE
                WHERE uro.id_usuario = u.id_usuario
                  AND (uro.expira_at IS NULL OR uro.expira_at > NOW())
                LIMIT 1) AS cargo
       FROM USUARIO u WHERE u.id_usuario = ?`,
      [req.user.id]
    );

    const { buffer, nombre: archivo } = construirActaNotificacionPdf({
      establecimiento: { nombre: registro?.establecimiento_nombre, rbd: registro?.rbd },
      caso: {
        id: activado.id_protocolo_activado,
        protocolo: activado.nombre,
        asunto: registro?.asunto,
        fecha_incidente: registro?.fecha_incidente,
      },
      paso: { nombre: g.paso_nombre },
      // Un paso de notificación al apoderado la emite a nombre de él: la
      // recibe y la firma el apoderado, no el estudiante.
      destinatario: g.tipo_paso === 'notificacion_apoderado' ? 'apoderado' : 'estudiante',
      persona: {
        nombre: g.nombre,
        rut: g.rut,
        curso: formatearNombreCurso(g.curso),
        rol: g.rol ? etiquetaDe(g.rol, 'rol_involucrado') : '',
      },
      medidas: suyas.map((m) => ({
        descripcion: m.descripcion,
        tipo_medida: m.tipo_medida ? etiquetaDe(m.tipo_medida, 'tipo_medida_disciplinaria') : '',
        fecha_aplicacion: m.fecha_aplicacion,
      })),
      plazo: textoPlazo(dias, esExpulsion),
      notificador: {
        nombre: notificador?.nombre ?? '',
        cargo: notificador?.cargo ?? '',
        correo: notificador?.correo ?? '',
      },
    });

    enviarPdf(res, buffer, archivo);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ message: 'No se pudo generar el acta de notificación' });
  }
};

module.exports = {
  getByCaso, agregar, cambiarRol, quitar, registrarGestion,
  adjuntarActaFirmada, descargarActaFirmada, generarActaNotificacion,
};
