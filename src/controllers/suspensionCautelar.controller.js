const pool = require('../db/connection');
const { calcularFechaLimite } = require('../utils/flujoProtocolo');
const { cargarFeriados } = require('../services/feriados.service');

// Suspensión cautelar del art. 6 letra d) del DFL 2/1998.
//
// No confundir con la suspensión de protección del art. 16 E letra j, que vive
// en MEDIDA_PROTECCION. Son institutos distintos y por eso tienen tablas
// distintas: la de protección resguarda a la persona afectada y dura hasta 15
// días hábiles; esta acompaña al procedimiento sancionatorio y lo que la ley
// le pone tope no es su duración sino el plazo para RESOLVER — diez días
// hábiles desde la notificación.
//
// Las reglas que el motor de pasos no sabe expresar, y que por eso están acá:
//
//  - La notificación tiene que ser POR ESCRITO y con fundamentos. De ahí que
//    `fundamento` sea obligatorio y que el enum de medios no incluya teléfono.
//  - Los dos plazos se calculan desde la notificación, no se digitan.
//  - Interponer la reconsideración "ampliará el plazo de suspensión del alumno
//    hasta culminar su tramitación": el caso deja de estar en infracción
//    mientras se tramita, pero la fecha límite original no se reescribe. Es un
//    hecho del expediente, no un número que convenga mover.
//  - Resolver después de una reconsideración exige el pronunciamiento escrito
//    del Consejo de Profesores. La ley lo pide como requisito, no como trámite.
//
// Lo que deliberadamente NO se modela: que la cautelar "no será considerada
// sanción cuando resuelto el procedimiento se imponga una más gravosa". Es una
// regla de interpretación sobre la medida, no un dato del expediente.

const DIAS_HABILES_RESOLUCION = 10;

// El art. 6 d) dice "cinco días" a secas, dos líneas después de decir "diez
// días hábiles". El contraste hace dudar, pero no hay que interpretarlo: la
// regla supletoria lo resuelve. Ley 19.880 art. 25 y el propio glosario de la
// Supereduc (entrada "Plazos"): "los plazos de días son de días hábiles,
// entendiéndose que son inhábiles los días sábados, domingos y festivos".
//
// Aun así el dato es informativo: `fuera_de_plazo` avisa, pero nunca se rechaza
// una reconsideración por llegar tarde. Rechazarla es un vicio de forma que se
// lleva puesta la resolución entera; admitirla de más no le cuesta nada al
// establecimiento.
const DIAS_HABILES_RECONSIDERACION = 5;

const MEDIOS_NOTIFICACION = ['presencial', 'correo', 'plataforma', 'carta'];

// Estados en los que la cautelar sigue abierta: cuentan para el tope de una por
// persona y son los únicos desde los que se puede reconsiderar o resolver.
const ABIERTAS = ['vigente', 'ampliada_por_reconsideracion', 'vencida'];

const SELECT_SUSPENSION = `
  SELECT sc.*,
         e.nombre AS estudiante_nombre, e.apellido AS estudiante_apellido,
         u.correo AS decretada_por
  FROM SUSPENSION_CAUTELAR sc
  LEFT JOIN ESTUDIANTE e ON e.id_estudiante = sc.id_estudiante
  JOIN USUARIO u ON u.id_usuario = sc.id_usuario
`;

// Mismo criterio que el resto del sistema: 404 y no 403 para un caso ajeno.
// Quien pregunta por un caso de otro establecimiento no tiene por qué
// enterarse de que existe.
const buscarCaso = async (id_protocolo_activado, id_establecimiento) => {
  const [[caso]] = await pool.query(
    `SELECT id_protocolo_activado, id_registro, id_establecimiento, estado
     FROM PROTOCOLO_ACTIVADO
     WHERE id_protocolo_activado = ? AND id_establecimiento = ?`,
    [id_protocolo_activado, id_establecimiento]
  );
  return caso ?? null;
};

// El plazo se cuenta desde el día de la notificación, sin que la hora influya:
// notificar a las 8 o a las 18 del mismo día no cambia el cómputo legal.
const diaDe = (fecha) => new Date(String(fecha).slice(0, 10) + 'T12:00:00Z');

const aISO = (fecha) => fecha.toISOString().slice(0, 10);

// GET /api/protocolos-activados/:id/suspensiones-cautelares
const getByCaso = async (req, res) => {
  try {
    const caso = await buscarCaso(req.params.id, req.id_establecimiento);
    if (!caso) return res.status(404).json({ message: 'Caso no encontrado' });

    const [suspensiones] = await pool.query(
      `${SELECT_SUSPENSION} WHERE sc.id_protocolo_activado = ?
       ORDER BY sc.fecha_notificacion, sc.id_suspension_cautelar`,
      [req.params.id]
    );

    const hoy = new Date().toISOString().slice(0, 10);
    res.json(suspensiones.map((s) => ({
      ...s,
      // El plazo para resolver se pasó y nadie resolvió: el caso está en
      // infracción. Se calcula acá y no se espera a un job, porque el listado
      // no puede mostrar como vigente algo que ya venció.
      //
      // Una reconsideración en tramitación no cuenta: la ley amplía la
      // suspensión hasta que termine.
      en_infraccion:
        s.estado === 'vigente' &&
        s.fecha_resolucion === null &&
        s.fecha_limite_resolucion < hoy,
      // Si la reconsideración llegó tarde. Informativo: la decisión de
      // admitirla igual es del director, no del sistema.
      reconsideracion_fuera_de_plazo:
        s.fecha_reconsideracion !== null &&
        s.fecha_reconsideracion > s.fecha_limite_reconsideracion,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener las suspensiones cautelares' });
  }
};

// POST /api/protocolos-activados/:id/suspensiones-cautelares
const crear = async (req, res) => {
  const { fundamento, fecha_notificacion, medio_notificacion, id_estudiante,
          id_activado_paso } = req.body;

  // La ley manda notificar "la decisión de suspender, JUNTO A SUS FUNDAMENTOS".
  // Sin fundamento escrito la medida no se puede sostener en una fiscalización,
  // así que no se deja registrar a medias para completarla después.
  if (!fundamento?.trim())
    return res.status(400).json({
      message:
        'La suspensión cautelar requiere fundamentos por escrito: la ley obliga a notificarlos ' +
        'junto con la decisión (art. 6 letra d)',
    });

  if (!fecha_notificacion)
    return res.status(400).json({ message: 'La fecha de notificación es requerida' });

  // Es la fecha que arranca los dos plazos legales. Una notificación futura
  // dejaría plazos que todavía no corren y una alerta que miente.
  if (String(fecha_notificacion).slice(0, 10) > new Date().toISOString().slice(0, 10))
    return res.status(400).json({ message: 'La fecha de notificación no puede ser futura' });

  if (!MEDIOS_NOTIFICACION.includes(medio_notificacion))
    return res.status(400).json({
      message:
        'El medio de notificación debe ser uno escrito (presencial con acta, correo, plataforma o carta): ' +
        'la ley exige notificar por escrito',
    });

  const conn = await pool.getConnection();
  try {
    const caso = await buscarCaso(req.params.id, req.id_establecimiento);
    if (!caso) return res.status(404).json({ message: 'Caso no encontrado' });
    if (caso.estado !== 'activo')
      return res.status(409).json({ message: 'El caso no está activo' });

    // De qué paso salió. Opcional, pero si viene tiene que ser un paso de ESTE
    // caso: apuntar a uno ajeno daría por cumplido un paso de otro protocolo.
    if (id_activado_paso) {
      const [[paso]] = await conn.query(
        'SELECT id_activado_paso FROM PROTOCOLO_ACTIVADO_PASO WHERE id_activado_paso = ? AND id_protocolo_activado = ?',
        [id_activado_paso, req.params.id]
      );
      if (!paso)
        return res.status(400).json({ message: 'El paso indicado no pertenece a este caso' });
    }

    // Una sola cautelar abierta por persona y caso. Dos superpuestas dejarían
    // dos plazos de diez días corriendo sobre el mismo procedimiento, y ninguno
    // de los dos sería el que hay que defender.
    const [[abierta]] = await conn.query(
      `SELECT id_suspension_cautelar FROM SUSPENSION_CAUTELAR
       WHERE id_protocolo_activado = ? AND estado IN (?)
         AND ((id_estudiante IS NULL AND ? IS NULL) OR id_estudiante = ?)
       LIMIT 1`,
      [req.params.id, ABIERTAS, id_estudiante || null, id_estudiante || null]
    );
    if (abierta)
      return res.status(409).json({
        message:
          'Ya hay una suspensión cautelar sin resolver para esa persona en este caso. ' +
          'Resolvé la anterior antes de decretar otra.',
      });

    // Los plazos se calculan, no se digitan: son los de la ley, no fechas que
    // alguien elija. Con los feriados de la región del establecimiento.
    const feriados = await cargarFeriados(req.id_establecimiento);
    const desde = diaDe(fecha_notificacion);
    const fecha_limite_resolucion = aISO(
      calcularFechaLimite(desde, DIAS_HABILES_RESOLUCION, 'dias_habiles', feriados)
    );
    const fecha_limite_reconsideracion = aISO(
      calcularFechaLimite(desde, DIAS_HABILES_RECONSIDERACION, 'dias_habiles', feriados)
    );

    await conn.beginTransaction();

    const [r] = await conn.query(
      // El involucrado se resuelve solo desde (caso, estudiante), igual que en
      // MEDIDA_PROTECCION: un caso con dos señalados no puede permitir
      // atribuirle la medida al que no era. Queda NULL si esa persona no figura
      // como involucrada, que es la verdad y no una atribución inventada.
      `INSERT INTO SUSPENSION_CAUTELAR
         (id_protocolo_activado, id_establecimiento, id_estudiante, id_involucrado,
          fundamento, fecha_notificacion, medio_notificacion,
          fecha_limite_resolucion, fecha_limite_reconsideracion, id_usuario,
          id_activado_paso)
       VALUES (?, ?, ?,
               (SELECT id_involucrado FROM PROTOCOLO_ACTIVADO_INVOLUCRADO
                WHERE id_protocolo_activado = ? AND id_estudiante = ? LIMIT 1),
               ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, req.id_establecimiento, id_estudiante || null,
       req.params.id, id_estudiante || null,
       fundamento.trim(), fecha_notificacion, medio_notificacion,
       fecha_limite_resolucion, fecha_limite_reconsideracion, req.user.id,
       id_activado_paso || null]
    );

    await conn.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES (?, ?, 'suspension_cautelar_aplicada', ?, ?, NOW())`,
      [req.params.id, req.id_establecimiento,
       `Suspensión cautelar notificada por ${medio_notificacion}. ` +
       `Plazo para resolver: ${fecha_limite_resolucion}`,
       req.user.id]
    );

    await conn.commit();
    res.status(201).json({
      id_suspension_cautelar: r.insertId,
      fecha_limite_resolucion,
      fecha_limite_reconsideracion,
      message: 'Suspensión cautelar registrada',
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al registrar la suspensión cautelar' });
  } finally {
    conn.release();
  }
};

const buscarSuspension = async (conn, id, id_establecimiento) => {
  const [[s]] = await conn.query(
    `SELECT * FROM SUSPENSION_CAUTELAR
     WHERE id_suspension_cautelar = ? AND id_establecimiento = ?`,
    [id, id_establecimiento]
  );
  return s ?? null;
};

// PUT /api/suspensiones-cautelares/:id
//
// Corregir una cautelar mal cargada. La medida se notifica por escrito y con
// fundamentos, así que esto NO es reescribir lo notificado: es la ventana para
// arreglar el error de digitación mientras la medida todavía no produjo ningún
// efecto propio en el expediente.
//
// Se cierra apenas pasa cualquiera de estas dos cosas:
//
//  - el apoderado interpuso reconsideración: pidió reconsiderar ESTOS
//    fundamentos y ESTA fecha, y moverlos después deja su escrito respondiendo
//    a un texto que ya no existe;
//  - la suspensión se resolvió: ahí ya es un hecho cerrado del procedimiento.
//
// Cambiar la fecha de notificación recalcula los dos plazos, porque los dos se
// cuentan desde ella. Nunca se digitan.
const actualizar = async (req, res) => {
  const { fundamento, fecha_notificacion, medio_notificacion, id_estudiante } = req.body;

  // Las mismas exigencias que al crear: una cautelar corregida tiene que quedar
  // tan defendible como una recién decretada.
  if (!fundamento?.trim())
    return res.status(400).json({
      message:
        'La suspensión cautelar requiere fundamentos por escrito: la ley obliga a notificarlos ' +
        'junto con la decisión (art. 6 letra d)',
    });
  if (!fecha_notificacion)
    return res.status(400).json({ message: 'La fecha de notificación es requerida' });
  if (String(fecha_notificacion).slice(0, 10) > new Date().toISOString().slice(0, 10))
    return res.status(400).json({ message: 'La fecha de notificación no puede ser futura' });
  if (!MEDIOS_NOTIFICACION.includes(medio_notificacion))
    return res.status(400).json({
      message:
        'El medio de notificación debe ser uno escrito (presencial con acta, correo, plataforma o carta): ' +
        'la ley exige notificar por escrito',
    });

  const conn = await pool.getConnection();
  try {
    const suspension = await buscarSuspension(conn, req.params.id, req.id_establecimiento);
    if (!suspension) return res.status(404).json({ message: 'Suspensión cautelar no encontrada' });

    if (suspension.estado === 'resuelta')
      return res.status(409).json({
        message: 'La suspensión ya fue resuelta: es un hecho cerrado del procedimiento y no se corrige.',
      });
    if (suspension.fecha_reconsideracion !== null)
      return res.status(409).json({
        message:
          'Ya se interpuso reconsideración contra esta suspensión: se pidió reconsiderar estos ' +
          'fundamentos y esta fecha, así que ya no se pueden cambiar.',
      });

    // Si la medida cambia de persona, el tope de una cautelar abierta por
    // persona y caso tiene que seguir valiendo: dos superpuestas dejarían dos
    // plazos de diez días corriendo sobre el mismo procedimiento.
    if ((suspension.id_estudiante ?? null) !== (id_estudiante || null)) {
      const [[abierta]] = await conn.query(
        `SELECT id_suspension_cautelar FROM SUSPENSION_CAUTELAR
         WHERE id_protocolo_activado = ? AND estado IN (?)
           AND id_suspension_cautelar <> ?
           AND ((id_estudiante IS NULL AND ? IS NULL) OR id_estudiante = ?)
         LIMIT 1`,
        [suspension.id_protocolo_activado, ABIERTAS, req.params.id,
         id_estudiante || null, id_estudiante || null]
      );
      if (abierta)
        return res.status(409).json({
          message:
            'Ya hay una suspensión cautelar sin resolver para esa persona en este caso. ' +
            'Resolvé la anterior antes de traspasarle esta.',
        });
    }

    // Los dos plazos se recalculan desde la notificación nueva.
    const feriados = await cargarFeriados(req.id_establecimiento);
    const desde = diaDe(fecha_notificacion);
    const fecha_limite_resolucion = aISO(
      calcularFechaLimite(desde, DIAS_HABILES_RESOLUCION, 'dias_habiles', feriados)
    );
    const fecha_limite_reconsideracion = aISO(
      calcularFechaLimite(desde, DIAS_HABILES_RECONSIDERACION, 'dias_habiles', feriados)
    );

    await conn.beginTransaction();

    await conn.query(
      `UPDATE SUSPENSION_CAUTELAR
       SET fundamento = ?, fecha_notificacion = ?, medio_notificacion = ?, id_estudiante = ?,
           id_involucrado = (SELECT id_involucrado FROM PROTOCOLO_ACTIVADO_INVOLUCRADO
                             WHERE id_protocolo_activado = ? AND id_estudiante = ? LIMIT 1),
           fecha_limite_resolucion = ?, fecha_limite_reconsideracion = ?
       WHERE id_suspension_cautelar = ?`,
      [fundamento.trim(), fecha_notificacion, medio_notificacion, id_estudiante || null,
       suspension.id_protocolo_activado, id_estudiante || null,
       fecha_limite_resolucion, fecha_limite_reconsideracion, req.params.id]
    );

    const antes = String(suspension.fecha_notificacion).slice(0, 10);
    const ahora = String(fecha_notificacion).slice(0, 10);
    const cambios = [];
    if (antes !== ahora) cambios.push(`notificación ${antes} → ${ahora} (plazo para resolver: ${fecha_limite_resolucion})`);
    if (suspension.medio_notificacion !== medio_notificacion)
      cambios.push(`medio ${suspension.medio_notificacion} → ${medio_notificacion}`);
    if ((suspension.id_estudiante ?? null) !== (id_estudiante || null)) cambios.push('estudiante');
    if (suspension.fundamento !== fundamento.trim()) cambios.push('fundamentos');

    await conn.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES (?, ?, 'suspension_cautelar_editada', ?, ?, NOW())`,
      [suspension.id_protocolo_activado, req.id_establecimiento,
       `Se corrige la suspensión cautelar: ${cambios.join(', ') || 'sin cambios de fondo'}`,
       req.user.id]
    );

    await conn.commit();
    res.json({
      fecha_limite_resolucion,
      fecha_limite_reconsideracion,
      message: 'Suspensión cautelar actualizada',
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar la suspensión cautelar' });
  } finally {
    conn.release();
  }
};

// PATCH /api/suspensiones-cautelares/:id/reconsideracion
//
// Interponerla amplía la suspensión hasta culminar su tramitación. Por eso el
// estado pasa a `ampliada_por_reconsideracion`, que apaga la alerta de
// vencimiento sin tocar `fecha_limite_resolucion`: la fecha original queda como
// hecho del expediente y no como un número que se movió para que no molestara.
//
// El acta del Consejo de Profesores puede llegar después (se consulta al
// Consejo para resolver, no para recibir el escrito), así que acá es opcional.
// Al resolver deja de serlo.
const registrarReconsideracion = async (req, res) => {
  const { fecha_reconsideracion, consejo_profesores_acta, fecha_consejo } = req.body;

  if (!fecha_reconsideracion)
    return res.status(400).json({ message: 'La fecha de la reconsideración es requerida' });

  const conn = await pool.getConnection();
  try {
    const suspension = await buscarSuspension(conn, req.params.id, req.id_establecimiento);
    if (!suspension) return res.status(404).json({ message: 'Suspensión cautelar no encontrada' });

    if (suspension.estado === 'resuelta')
      return res.status(409).json({
        message: 'El procedimiento ya fue resuelto: no se puede reconsiderar una medida cerrada',
      });
    if (suspension.fecha_reconsideracion !== null)
      return res.status(409).json({ message: 'Esta suspensión ya tiene una reconsideración registrada' });

    await conn.beginTransaction();
    await conn.query(
      `UPDATE SUSPENSION_CAUTELAR
       SET fecha_reconsideracion = ?, consejo_profesores_acta = ?, fecha_consejo = ?,
           estado = 'ampliada_por_reconsideracion'
       WHERE id_suspension_cautelar = ?`,
      [fecha_reconsideracion, consejo_profesores_acta?.trim() || null,
       fecha_consejo || null, req.params.id]
    );
    await conn.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES (?, ?, 'suspension_cautelar_reconsiderada', ?, ?, NOW())`,
      [suspension.id_protocolo_activado, req.id_establecimiento,
       'Reconsideración interpuesta: la suspensión se amplía hasta culminar su tramitación',
       req.user.id]
    );
    await conn.commit();

    // Se avisa, no se rechaza. Ver el comentario de DIAS_HABILES_RECONSIDERACION.
    const fuera_de_plazo =
      String(fecha_reconsideracion).slice(0, 10) > suspension.fecha_limite_reconsideracion;

    res.json({
      message: 'Reconsideración registrada',
      fuera_de_plazo,
      aviso: fuera_de_plazo
        ? `La reconsideración se presentó después del ${suspension.fecha_limite_reconsideracion}. ` +
          'Queda registrada igual; admitirla o no es decisión del director.'
        : null,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al registrar la reconsideración' });
  } finally {
    conn.release();
  }
};

// PATCH /api/suspensiones-cautelares/:id/resolver
//
// Cierra el procedimiento sancionatorio y con él la cautelar. Si hubo
// reconsideración, la ley exige que el director resuelva "previa consulta al
// Consejo de Profesores, el que deberá pronunciarse por escrito": sin esa acta
// no se deja resolver, porque una resolución sin ella es anulable.
const resolver = async (req, res) => {
  const { fecha_resolucion, resultado_reconsideracion, consejo_profesores_acta, fecha_consejo } = req.body;

  const conn = await pool.getConnection();
  try {
    const suspension = await buscarSuspension(conn, req.params.id, req.id_establecimiento);
    if (!suspension) return res.status(404).json({ message: 'Suspensión cautelar no encontrada' });
    if (suspension.estado === 'resuelta')
      return res.status(409).json({ message: 'La suspensión cautelar ya fue resuelta' });

    const hubo_reconsideracion = suspension.fecha_reconsideracion !== null;
    const acta = consejo_profesores_acta?.trim() || suspension.consejo_profesores_acta;

    if (hubo_reconsideracion && !acta)
      return res.status(409).json({
        message:
          'Hay una reconsideración pendiente: para resolverla hay que registrar el pronunciamiento ' +
          'por escrito del Consejo de Profesores (art. 6 letra d)',
        requiere_acta_consejo: true,
      });

    if (hubo_reconsideracion && !['acogida', 'rechazada'].includes(resultado_reconsideracion))
      return res.status(400).json({
        message: 'Indicá si la reconsideración se acoge o se rechaza',
      });

    const fecha = fecha_resolucion || new Date().toISOString().slice(0, 10);

    await conn.beginTransaction();
    await conn.query(
      `UPDATE SUSPENSION_CAUTELAR
       SET estado = 'resuelta', fecha_resolucion = ?,
           resultado_reconsideracion = ?,
           consejo_profesores_acta = ?, fecha_consejo = COALESCE(?, fecha_consejo)
       WHERE id_suspension_cautelar = ?`,
      [fecha, hubo_reconsideracion ? resultado_reconsideracion : null,
       acta || null, fecha_consejo || null, req.params.id]
    );
    await conn.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES (?, ?, 'suspension_cautelar_resuelta', ?, ?, NOW())`,
      [suspension.id_protocolo_activado, req.id_establecimiento,
       hubo_reconsideracion
         ? `Procedimiento resuelto. Reconsideración ${resultado_reconsideracion}.`
         : 'Procedimiento resuelto dentro de la suspensión cautelar',
       req.user.id]
    );
    await conn.commit();

    // Se informa, no se bloquea: el procedimiento se resolvió tarde y eso es un
    // hecho que el expediente tiene que mostrar, no algo que convenga esconder
    // impidiendo el registro.
    const fuera_de_plazo =
      !hubo_reconsideracion && fecha > suspension.fecha_limite_resolucion;

    res.json({
      message: 'Suspensión cautelar resuelta',
      fuera_de_plazo,
      aviso: fuera_de_plazo
        ? `El procedimiento se resolvió después del plazo de ${DIAS_HABILES_RESOLUCION} días hábiles ` +
          `(vencía el ${suspension.fecha_limite_resolucion}). Queda registrado en la bitácora del caso.`
        : null,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al resolver la suspensión cautelar' });
  } finally {
    conn.release();
  }
};

module.exports = {
  getByCaso, crear, actualizar, registrarReconsideracion, resolver,
  DIAS_HABILES_RESOLUCION, DIAS_HABILES_RECONSIDERACION, MEDIOS_NOTIFICACION,
};
