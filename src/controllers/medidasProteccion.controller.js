const pool = require('../db/connection');
const { calcularFechaLimite } = require('../utils/flujoProtocolo');
const { cargarFeriados } = require('../services/feriados.service');
const notificaciones = require('../services/notificaciones.service');
const { TIPOS_MEDIDA, etiquetaTipo } = require('../constants/medidasProteccion');

// Medidas de protección de un caso (art. 16 E letra j).
//
// No son un paso más del grafo, y por eso viven en su propia tabla: tienen
// reglas que el motor de pasos no sabe expresar.
//
//  - La suspensión no puede pasar de 15 días hábiles.
//  - Si vence y el procedimiento no concluyó, hay que adoptar OTRA medida. No
//    se puede extender la suspensión: por eso "concluir" una suspensión vencida
//    exige indicar la medida que la sustituye.
//  - Si se reaplica por reiteración, la investigación debe terminar antes del
//    término del nuevo plazo. Esa segunda suspensión le pone techo al caso
//    completo, más duro que el de 2 meses.
//
// La medida se determina desde que el establecimiento toma conocimiento y puede
// extenderse hasta la conclusión del procedimiento. Después del cierre la ley
// no exige seguimiento, así que acá tampoco se fuerza ninguno.

const MAX_DIAS_SUSPENSION = 15;

// El art. 16 E letra j impone DOS deberes sobre el estudiante suspendido, no
// uno: "realizar un monitoreo pedagógico del estudiante suspendido Y disponer
// medidas para resguardar la continuidad de su trayectoria educativa". Con una
// descripción libre los dos caben en el mismo registro y después no se puede
// responder por separado cuál se cumplió.
const TIPOS_SEGUIMIENTO = ['monitoreo_pedagogico', 'continuidad_trayectoria', 'otro'];

const SELECT_MEDIDA = `
  SELECT mp.*,
         e.nombre AS estudiante_nombre, e.apellido AS estudiante_apellido,
         u.correo AS registrada_por
  FROM MEDIDA_PROTECCION mp
  LEFT JOIN ESTUDIANTE e ON e.id_estudiante = mp.id_estudiante
  JOIN USUARIO u ON u.id_usuario = mp.id_usuario
`;

// El caso tiene que ser del establecimiento del usuario. Se responde 404 y no
// 403 por lo mismo que el resto del sistema: quien pregunta por un caso ajeno
// no tiene por qué enterarse de que existe.
const buscarCaso = async (id_protocolo_activado, id_establecimiento) => {
  const [[caso]] = await pool.query(
    `SELECT id_protocolo_activado, id_registro, id_establecimiento, estado,
            fecha_limite_investigacion
     FROM PROTOCOLO_ACTIVADO
     WHERE id_protocolo_activado = ? AND id_establecimiento = ?`,
    [id_protocolo_activado, id_establecimiento]
  );
  return caso ?? null;
};

// GET /api/protocolos-activados/:id/medidas-proteccion
const getByCaso = async (req, res) => {
  try {
    const caso = await buscarCaso(req.params.id, req.id_establecimiento);
    if (!caso) return res.status(404).json({ message: 'Caso no encontrado' });

    const [medidas] = await pool.query(
      `${SELECT_MEDIDA} WHERE mp.id_protocolo_activado = ? ORDER BY mp.fecha_inicio, mp.id_medida_proteccion`,
      [req.params.id]
    );

    const ids = medidas.map((m) => m.id_medida_proteccion);
    let seguimientos = [];
    if (ids.length > 0) {
      [seguimientos] = await pool.query(
        `SELECT s.*, u.correo AS registrado_por
         FROM MEDIDA_PROTECCION_SEGUIMIENTO s
         JOIN USUARIO u ON u.id_usuario = s.id_usuario
         WHERE s.id_medida_proteccion IN (?) ORDER BY s.fecha, s.id_seguimiento`,
        [ids]
      );
    }

    const hoy = new Date().toISOString().slice(0, 10);
    res.json(medidas.map((m) => {
      const propios = seguimientos.filter((s) => s.id_medida_proteccion === m.id_medida_proteccion);
      // Los dos deberes del art. 16 E letra j se responden por separado. Solo
      // se exigen sobre la suspensión: es la única medida sobre la que la ley
      // los impone, porque es la única que saca al estudiante de clases.
      const esSuspension = m.tipo === 'suspension';
      return {
        ...m,
        // Una medida vigente cuyo término ya pasó está vencida aunque el job
        // todavía no haya corrido. El listado no puede depender de eso.
        vencida: m.estado === 'vigente' && m.fecha_termino !== null && m.fecha_termino < hoy,
        falta_monitoreo_pedagogico:
          esSuspension && !propios.some((s) => s.tipo === 'monitoreo_pedagogico'),
        falta_continuidad_trayectoria:
          esSuspension && !propios.some((s) => s.tipo === 'continuidad_trayectoria'),
        seguimientos: propios,
      };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener las medidas de protección' });
  }
};

// POST /api/protocolos-activados/:id/medidas-proteccion
const crear = async (req, res) => {
  const {
    tipo, descripcion, fundamento, id_estudiante,
    fecha_inicio, dias_habiles, es_reaplicacion, id_activado_paso,
  } = req.body;

  if (!tipo || !fecha_inicio)
    return res.status(400).json({ message: 'tipo y fecha_inicio son requeridos' });

  // El tipo se rechaza si no está en el catálogo en vez de aplanarlo a 'otra':
  // de él dependen el tope de 15 días y la obligación de sustituir la medida al
  // vencer, y una medida guardada como 'otra' se salta las dos.
  if (!TIPOS_MEDIDA.includes(tipo))
    return res.status(400).json({ message: `tipo inválido. Valores: ${TIPOS_MEDIDA.join(', ')}` });

  // La ley admite la suspensión solo cuando no se puede resguardar a la persona
  // afectada con otra medida. Exigir el fundamento por escrito es lo que hace
  // auditable esa decisión; sin él, el expediente no puede sostenerla.
  if (tipo === 'suspension' && !fundamento?.trim())
    return res.status(400).json({
      message:
        'La suspensión requiere fundamentar por qué no es posible resguardar a la persona afectada con otra medida',
    });

  if (tipo === 'suspension') {
    if (!dias_habiles)
      return res.status(400).json({ message: 'La suspensión requiere indicar los días hábiles' });
    if (dias_habiles > MAX_DIAS_SUSPENSION)
      return res.status(400).json({
        message: `La suspensión no puede extenderse por más de ${MAX_DIAS_SUSPENSION} días hábiles (art. 16 E letra j)`,
      });
  }

  const conn = await pool.getConnection();
  try {
    const caso = await buscarCaso(req.params.id, req.id_establecimiento);
    if (!caso) return res.status(404).json({ message: 'Caso no encontrado' });
    if (caso.estado !== 'activo')
      return res.status(409).json({ message: 'El caso no está activo' });

    // De qué paso salió la medida. Es opcional —la ley permite adoptarla
    // "desde el momento en que el establecimiento tome conocimiento", incluso
    // antes de llegar al paso de resguardo— pero si viene, tiene que ser un
    // paso de ESTE caso: apuntar a un paso ajeno haría que el otro protocolo
    // diera por cumplido un resguardo que nunca ordenó.
    if (id_activado_paso) {
      const [[paso]] = await conn.query(
        'SELECT id_activado_paso FROM PROTOCOLO_ACTIVADO_PASO WHERE id_activado_paso = ? AND id_protocolo_activado = ?',
        [id_activado_paso, req.params.id]
      );
      if (!paso)
        return res.status(400).json({ message: 'El paso indicado no pertenece a este caso' });
    }

    // El término se calcula, no se digita: es el plazo legal, no una fecha que
    // alguien elija. Con feriados de la región del establecimiento.
    let fecha_termino = null;
    if (dias_habiles) {
      const feriados = await cargarFeriados(req.id_establecimiento);
      fecha_termino = calcularFechaLimite(
        new Date(fecha_inicio + 'T12:00:00Z'), Number(dias_habiles), 'dias_habiles', feriados
      ).toISOString().slice(0, 10);
    }

    await conn.beginTransaction();

    const [r] = await conn.query(
      // El involucrado se resuelve solo desde (caso, estudiante): un caso con
      // dos señalados no puede permitir atribuirle la medida al que no era.
      // Queda en NULL si esa persona no figura como involucrada, que es la
      // verdad y no una atribución inventada.
      `INSERT INTO MEDIDA_PROTECCION
         (id_protocolo_activado, id_establecimiento, id_estudiante, id_involucrado, tipo, descripcion,
          fundamento, fecha_inicio, fecha_termino, dias_habiles, es_reaplicacion, id_usuario,
          id_activado_paso)
       VALUES (?, ?, ?,
               (SELECT id_involucrado FROM PROTOCOLO_ACTIVADO_INVOLUCRADO
                WHERE id_protocolo_activado = ? AND id_estudiante = ? LIMIT 1),
               ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, req.id_establecimiento, id_estudiante || null,
       req.params.id, id_estudiante || null, tipo,
       descripcion?.trim() || null, fundamento?.trim() || null,
       fecha_inicio, fecha_termino, dias_habiles || null, es_reaplicacion ? 1 : 0, req.user.id,
       id_activado_paso || null]
    );

    // Reaplicación por reiteración: la investigación tiene que concluir antes
    // del término del nuevo plazo. Se toma el MENOR entre el techo que ya tenía
    // el caso (2 meses) y este, porque el nuevo plazo solo puede adelantarlo.
    if (es_reaplicacion && tipo === 'suspension' && fecha_termino) {
      await conn.query(
        `UPDATE PROTOCOLO_ACTIVADO
         SET fecha_limite_investigacion = LEAST(COALESCE(fecha_limite_investigacion, ?), ?)
         WHERE id_protocolo_activado = ?`,
        [fecha_termino, fecha_termino, req.params.id]
      );
    }

    await conn.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES (?, ?, 'medida_proteccion_aplicada', ?, ?, NOW())`,
      [req.params.id, req.id_establecimiento,
       `${tipo}${fecha_termino ? ` hasta el ${fecha_termino}` : ''}`, req.user.id]
    );

    await conn.commit();
    res.status(201).json({
      id_medida_proteccion: r.insertId,
      fecha_termino,
      message: 'Medida de protección registrada',
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al registrar la medida de protección' });
  } finally {
    conn.release();
  }
};

// PUT /api/medidas-proteccion/:id
//
// Corregir una medida mal cargada. No es "editar el expediente": es la ventana
// para arreglar el error de tipeo del día que se registró, y por eso se cierra
// apenas la medida empieza a producir efectos propios.
//
// Solo mientras la medida está `vigente` y todavía no tiene seguimientos: un
// seguimiento es un hecho ocurrido bajo esta medida y con estas fechas —
// moverle el plazo después dejaría el monitoreo colgando de un período que ya
// no existe. Una medida concluida o sustituida tampoco se toca: ya cerró y
// puede estar sosteniendo a la que la reemplazó.
//
// El cambio queda en la bitácora del caso con el antes y el después: corregir
// sin dejar rastro es lo que una fiscalización no puede distinguir de alterar.
const actualizar = async (req, res) => {
  const {
    tipo, descripcion, fundamento, id_estudiante,
    fecha_inicio, dias_habiles, es_reaplicacion,
  } = req.body;

  if (!tipo || !fecha_inicio)
    return res.status(400).json({ message: 'tipo y fecha_inicio son requeridos' });

  // El tipo se rechaza si no está en el catálogo en vez de aplanarlo a 'otra':
  // de él dependen el tope de 15 días y la obligación de sustituir la medida al
  // vencer, y una medida guardada como 'otra' se salta las dos.
  if (!TIPOS_MEDIDA.includes(tipo))
    return res.status(400).json({ message: `tipo inválido. Valores: ${TIPOS_MEDIDA.join(', ')}` });

  // Las mismas reglas que al crear: una medida corregida tiene que quedar tan
  // defendible como una recién registrada.
  if (tipo === 'suspension' && !fundamento?.trim())
    return res.status(400).json({
      message:
        'La suspensión requiere fundamentar por qué no es posible resguardar a la persona afectada con otra medida',
    });
  if (tipo === 'suspension') {
    if (!dias_habiles)
      return res.status(400).json({ message: 'La suspensión requiere indicar los días hábiles' });
    if (dias_habiles > MAX_DIAS_SUSPENSION)
      return res.status(400).json({
        message: `La suspensión no puede extenderse por más de ${MAX_DIAS_SUSPENSION} días hábiles (art. 16 E letra j)`,
      });
  }

  const conn = await pool.getConnection();
  try {
    const [[medida]] = await conn.query(
      `SELECT mp.*,
              (SELECT COUNT(*) FROM MEDIDA_PROTECCION_SEGUIMIENTO s
               WHERE s.id_medida_proteccion = mp.id_medida_proteccion) AS seguimientos,
              (SELECT COUNT(*) FROM MEDIDA_PROTECCION o
               WHERE o.id_medida_sustituye = mp.id_medida_proteccion) AS sustituye_a
       FROM MEDIDA_PROTECCION mp
       WHERE mp.id_medida_proteccion = ? AND mp.id_establecimiento = ?`,
      [req.params.id, req.id_establecimiento]
    );
    if (!medida) return res.status(404).json({ message: 'Medida no encontrada' });

    if (medida.estado !== 'vigente')
      return res.status(409).json({
        message:
          `La medida está ${medida.estado} y ya no se puede corregir. ` +
          'Registrá una medida nueva en su lugar.',
      });
    if (medida.seguimientos > 0)
      return res.status(409).json({
        message:
          `Esta medida ya tiene ${medida.seguimientos} seguimiento(s) registrado(s) sobre sus fechas: ` +
          'corregirla ahora dejaría ese monitoreo colgando de un período que ya no existe.',
      });
    if (medida.sustituye_a > 0)
      return res.status(409).json({
        message: 'Esta medida sustituyó a otra que ya se cerró apoyándose en ella: no se puede corregir.',
      });

    // El término se recalcula, igual que al crear: es el plazo legal y no una
    // fecha que alguien elija.
    let fecha_termino = null;
    if (dias_habiles) {
      const feriados = await cargarFeriados(req.id_establecimiento);
      fecha_termino = calcularFechaLimite(
        new Date(fecha_inicio + 'T12:00:00Z'), Number(dias_habiles), 'dias_habiles', feriados
      ).toISOString().slice(0, 10);
    }

    await conn.beginTransaction();

    await conn.query(
      `UPDATE MEDIDA_PROTECCION
       SET tipo = ?, descripcion = ?, fundamento = ?, id_estudiante = ?,
           id_involucrado = (SELECT id_involucrado FROM PROTOCOLO_ACTIVADO_INVOLUCRADO
                             WHERE id_protocolo_activado = ? AND id_estudiante = ? LIMIT 1),
           fecha_inicio = ?, fecha_termino = ?, dias_habiles = ?, es_reaplicacion = ?
       WHERE id_medida_proteccion = ?`,
      [tipo, descripcion?.trim() || null, fundamento?.trim() || null, id_estudiante || null,
       medida.id_protocolo_activado, id_estudiante || null,
       fecha_inicio, fecha_termino, dias_habiles || null, es_reaplicacion ? 1 : 0, req.params.id]
    );

    // El techo que la reaplicación le puso al caso se recalcula sobre el plazo
    // nuevo. No se puede "devolver" el que ya se había adelantado — LEAST no es
    // reversible sin saber cuál era el original —, pero sí adelantarlo más.
    if (es_reaplicacion && tipo === 'suspension' && fecha_termino) {
      await conn.query(
        `UPDATE PROTOCOLO_ACTIVADO
         SET fecha_limite_investigacion = LEAST(COALESCE(fecha_limite_investigacion, ?), ?)
         WHERE id_protocolo_activado = ?`,
        [fecha_termino, fecha_termino, medida.id_protocolo_activado]
      );
    }

    const cambios = [];
    if (medida.tipo !== tipo)
      cambios.push(`tipo ${etiquetaTipo(medida.tipo)} → ${etiquetaTipo(tipo)}`);
    if (String(medida.fecha_inicio).slice(0, 10) !== fecha_inicio)
      cambios.push(`inicio ${String(medida.fecha_inicio).slice(0, 10)} → ${fecha_inicio}`);
    if (String(medida.fecha_termino ?? '') !== String(fecha_termino ?? ''))
      cambios.push(`término ${medida.fecha_termino ?? 'sin plazo'} → ${fecha_termino ?? 'sin plazo'}`);
    if ((medida.id_estudiante ?? null) !== (id_estudiante || null)) cambios.push('estudiante');
    if ((medida.fundamento ?? '') !== (fundamento?.trim() || '')) cambios.push('fundamento');
    if ((medida.descripcion ?? '') !== (descripcion?.trim() || '')) cambios.push('descripción');

    await conn.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES (?, ?, 'medida_proteccion_editada', ?, ?, NOW())`,
      [medida.id_protocolo_activado, req.id_establecimiento,
       `Se corrige la medida de protección: ${cambios.join(', ') || 'sin cambios de fondo'}`,
       req.user.id]
    );

    await conn.commit();
    res.json({ fecha_termino, message: 'Medida de protección actualizada' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar la medida de protección' });
  } finally {
    conn.release();
  }
};

// PATCH /api/medidas-proteccion/:id/finalizar
//
// Concluir una medida vigente. Si es una suspensión que ya venció y el caso
// sigue abierto, la ley obliga a adoptar otra medida: sin `id_medida_sustituye`
// se rechaza, porque dejar el caso sin ninguna medida de protección es
// exactamente lo que el art. 16 E letra j prohíbe.
const finalizar = async (req, res) => {
  const { id_medida_sustituye } = req.body;

  const conn = await pool.getConnection();
  try {
    const [[medida]] = await conn.query(
      `SELECT mp.*, pa.estado AS estado_caso
       FROM MEDIDA_PROTECCION mp
       JOIN PROTOCOLO_ACTIVADO pa ON pa.id_protocolo_activado = mp.id_protocolo_activado
       WHERE mp.id_medida_proteccion = ? AND mp.id_establecimiento = ?`,
      [req.params.id, req.id_establecimiento]
    );
    if (!medida) return res.status(404).json({ message: 'Medida no encontrada' });
    if (medida.estado !== 'vigente')
      return res.status(409).json({ message: 'La medida ya no está vigente' });

    const hoy = new Date().toISOString().slice(0, 10);
    const vencida = medida.fecha_termino !== null && medida.fecha_termino < hoy;
    const exigeSustituta =
      medida.tipo === 'suspension' && vencida && medida.estado_caso === 'activo';

    if (exigeSustituta && !id_medida_sustituye)
      return res.status(409).json({
        message:
          'La suspensión venció y el procedimiento no ha concluido: hay que registrar la medida ' +
          'que la sustituye antes de cerrarla (art. 16 E letra j). No se puede extender la suspensión.',
        requiere_sustituta: true,
      });

    if (id_medida_sustituye) {
      const [[sustituta]] = await conn.query(
        `SELECT 1 AS ok FROM MEDIDA_PROTECCION
         WHERE id_medida_proteccion = ? AND id_protocolo_activado = ? AND id_medida_proteccion <> ?`,
        [id_medida_sustituye, medida.id_protocolo_activado, req.params.id]
      );
      if (!sustituta)
        return res.status(400).json({ message: 'La medida sustituta no pertenece a este caso' });
    }

    await conn.beginTransaction();
    await conn.query(
      `UPDATE MEDIDA_PROTECCION
       SET estado = ?, id_medida_sustituye = ?
       WHERE id_medida_proteccion = ?`,
      [id_medida_sustituye ? 'sustituida' : 'concluida', id_medida_sustituye || null, req.params.id]
    );
    await conn.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES (?, ?, 'medida_proteccion_finalizada', ?, ?, NOW())`,
      [medida.id_protocolo_activado, req.id_establecimiento,
       id_medida_sustituye
         ? `${etiquetaTipo(medida.tipo)} sustituida por otra medida`
         : `${etiquetaTipo(medida.tipo)} concluida`,
       req.user.id]
    );
    await conn.commit();
    res.json({ message: 'Medida finalizada' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al finalizar la medida' });
  } finally {
    conn.release();
  }
};

// POST /api/medidas-proteccion/:id/seguimiento
//
// Monitoreo pedagógico del estudiante suspendido (art. 16 E letra j). Es el
// único seguimiento que la ley exige, y es DURANTE la medida: no hay obligación
// de monitoreo después de cerrado el caso.
const registrarSeguimiento = async (req, res) => {
  const { fecha, descripcion, tipo } = req.body;

  if (!fecha || !descripcion?.trim())
    return res.status(400).json({ message: 'fecha y descripcion son requeridos' });

  if (tipo && !TIPOS_SEGUIMIENTO.includes(tipo))
    return res.status(400).json({ message: `tipo debe ser uno de: ${TIPOS_SEGUIMIENTO.join(', ')}` });

  try {
    const [[medida]] = await pool.query(
      'SELECT id_medida_proteccion FROM MEDIDA_PROTECCION WHERE id_medida_proteccion = ? AND id_establecimiento = ?',
      [req.params.id, req.id_establecimiento]
    );
    if (!medida) return res.status(404).json({ message: 'Medida no encontrada' });

    const [r] = await pool.query(
      `INSERT INTO MEDIDA_PROTECCION_SEGUIMIENTO (id_medida_proteccion, fecha, descripcion, tipo, id_usuario)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, fecha, descripcion.trim(), tipo || 'otro', req.user.id]
    );
    res.status(201).json({ id_seguimiento: r.insertId, message: 'Seguimiento registrado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al registrar el seguimiento' });
  }
};

module.exports = {
  getByCaso, crear, actualizar, finalizar, registrarSeguimiento,
  MAX_DIAS_SUSPENSION, TIPOS_MEDIDA,
};
