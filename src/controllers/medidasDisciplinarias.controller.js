const pool = require('../db/connection');
const { calcularFechaLimite } = require('../utils/flujoProtocolo');
const { cargarFeriados } = require('../services/feriados.service');

// Medidas disciplinarias aplicadas en un caso, con su resultado y su plazo.
//
// La tabla MEDIDA_DISCIPLINARIA existía desde antes pero nunca se usó del
// todo. Se retoma porque el informe previo de expulsión (art. 2 N° 5 de la
// Ley 21.809) exige explicitar la aplicación de cada medida previa "con
// indicación de los resultados obtenidos". Sin `resultado` poblado, ese
// informe no se puede generar y hay que escribirlo a mano desde cero.
//
// Por eso el resultado se registra en un segundo momento y no al aplicar la
// medida: cuando se aplica todavía no hay resultado que contar.
//
// Es un instituto distinto de la suspensión de MEDIDA_PROTECCION (16 E letra
// j, cautelar mientras se investiga) y de SUSPENSION_CAUTELAR (DFL 2 art. 6
// letra d, 10 días para resolver): esta es la sanción del RICE, aplicada
// DESPUÉS de resolver, y su tope de días viene de la Circular 482 p. 47, no
// de la ley general. Ver docs/medidas_disciplinarias_plazos.sql.

const SELECT_MEDIDA = `
  SELECT md.*,
         u.correo AS aplicada_por,
         e.nombre AS estudiante_nombre, e.apellido AS estudiante_apellido,
         p.nombre AS paso_nombre
  FROM MEDIDA_DISCIPLINARIA md
  JOIN USUARIO u ON u.id_usuario = md.id_usuario
  LEFT JOIN ESTUDIANTE e ON e.id_estudiante = md.id_estudiante
  LEFT JOIN PROTOCOLO_ACTIVADO_PASO p ON p.id_activado_paso = md.id_activado_paso
`;

// GET /api/registros/:id/medidas-disciplinarias
const getByRegistro = async (req, res) => {
  try {
    const [[registro]] = await pool.query(
      'SELECT id_registro FROM REGISTRO_CONVIVENCIA WHERE id_registro = ? AND id_establecimiento = ?',
      [req.params.id, req.id_establecimiento]
    );
    if (!registro) return res.status(404).json({ message: 'Registro no encontrado' });

    const [medidas] = await pool.query(
      `${SELECT_MEDIDA} WHERE md.id_registro = ? ORDER BY md.fecha_aplicacion, md.id_medida`,
      [req.params.id]
    );
    const hoy = new Date().toISOString().slice(0, 10);
    res.json(medidas.map((m) => ({
      ...m,
      // Igual que en medidas de protección: una medida vigente cuyo término ya
      // pasó está vencida aunque el job todavía no haya corrido.
      vencida: m.estado === 'vigente' && m.fecha_termino !== null && m.fecha_termino < hoy,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener las medidas disciplinarias' });
  }
};

// El catálogo de tipos, en el mismo orden del ENUM de la tabla y ordenado de
// menor a mayor gravedad. Los cuatro anteriores a 'otra' son las medidas
// excepcionales de la Circular 482 p. 47, las únicas que llevan duración en
// días hábiles.
//
// 'retiro_sala' (retirar al estudiante de la sala por lo que resta de la clase)
// y 'suspension_actividades' (quedar fuera de una actividad extraprogramática o
// de una ceremonia) son las dos medidas de baja/media intensidad que el RICE
// adaptado a la Ley 21.809 nombra y que antes había que registrar como 'otra'.
// Ninguna de las dos suspende el derecho a asistir a clases, así que no llevan
// días hábiles: se agotan en la clase o en el acto del que se excluye.
// La prohibición de participar en una ceremonia exige debido proceso y no puede
// fundarse en criterios discriminatorios (Circular 482 p. 47, (iii) letra c).
const TIPOS_MEDIDA = [
  'amonestacion', 'citacion_apoderado', 'medida_formativa', 'medida_reparatoria',
  'servicio_comunitario', 'derivacion', 'retiro_sala', 'suspension_actividades',
  'condicionalidad', 'suspension', 'reduccion_jornada', 'separacion_temporal',
  'asistencia_solo_evaluaciones', 'otra',
  // Las registra solas el motor al aprobarse el paso de decisión de expulsión
  // (ver registrarMedidaDeExpulsion); se aceptan también a mano para los casos
  // que se resolvieron antes de eso.
  'expulsion', 'cancelacion_matricula',
];

// Solo estas cuatro son "medidas excepcionales" (Circular 482 p. 47): proceden
// únicamente si hay peligro real para la integridad física o psicológica de
// alguien de la comunidad educativa, y son las únicas con duración en días
// hábiles.
const TIPOS_CON_PLAZO = ['suspension', 'reduccion_jornada', 'separacion_temporal', 'asistencia_solo_evaluaciones'];

// POST /api/registros/:id/medidas-disciplinarias
const crear = async (req, res) => {
  const {
    descripcion, tipo_medida, fundamento, fecha_aplicacion, fecha_revision,
    dias_habiles, es_prorroga, id_medida_prorrogada,
    id_estudiante, id_activado_paso,
  } = req.body;

  if (!descripcion?.trim() || !fecha_aplicacion)
    return res.status(400).json({ message: 'descripcion y fecha_aplicacion son requeridos' });

  // El tipo dejó de ser texto libre: de él dependen la duración y la revisión
  // semestral de la condicionalidad. Se rechaza un valor desconocido en vez de
  // aplanarlo a 'otra' — aplanar en silencio es cómo se pierde el dato que
  // después el informe de expulsión necesita.
  const tipo = tipo_medida?.trim();
  if (tipo && !TIPOS_MEDIDA.includes(tipo))
    return res.status(400).json({ message: `tipo_medida inválido. Valores: ${TIPOS_MEDIDA.join(', ')}` });

  const llevaPlazo = TIPOS_CON_PLAZO.includes(tipo || 'otra');
  // Las medidas excepcionales exigen fundamento por escrito y días hábiles:
  // sin esos dos datos el acta y el informe de expulsión no pueden sostener
  // por qué correspondía justo esta medida (Circular 482 p. 47: "justificadas
  // y debidamente acreditadas ANTES de su adopción").
  if (llevaPlazo && !fundamento?.trim())
    return res.status(400).json({
      message: 'Esta medida requiere fundamentar por qué correspondía (Circular 482 p. 47)',
    });
  if (llevaPlazo && !dias_habiles)
    return res.status(400).json({ message: 'Esta medida requiere indicar los días hábiles' });

  const conn = await pool.getConnection();
  try {
    const [[registro]] = await conn.query(
      'SELECT id_registro FROM REGISTRO_CONVIVENCIA WHERE id_registro = ? AND id_establecimiento = ?',
      [req.params.id, req.id_establecimiento]
    );
    if (!registro) return res.status(404).json({ message: 'Registro no encontrado' });

    // El término se calcula, no se digita: días hábiles desde fecha_aplicacion
    // descontando los feriados de la región del establecimiento. Digitarla a
    // mano es cómo se producen las suspensiones que en el papel duran tres
    // días y en el calendario cinco.
    let fecha_termino = null;
    if (dias_habiles) {
      const feriados = await cargarFeriados(req.id_establecimiento);
      fecha_termino = calcularFechaLimite(
        new Date(fecha_aplicacion + 'T12:00:00Z'), Number(dias_habiles), 'dias_habiles', feriados
      ).toISOString().slice(0, 10);
    }

    // La prórroga no se rechaza nunca: se advierte. El tope viene de una
    // circular, no de la ley, y bloquear el registro no consigue el
    // cumplimiento, consigue que no se registre.
    let avisoProrroga = null;
    if (es_prorroga && id_medida_prorrogada) {
      const [[original]] = await conn.query(
        `SELECT dias_habiles, es_prorroga,
                (SELECT COUNT(*) FROM MEDIDA_DISCIPLINARIA o
                 WHERE o.id_medida_prorrogada = ?) AS prorrogas_previas
         FROM MEDIDA_DISCIPLINARIA WHERE id_medida = ? AND id_establecimiento = ?`,
        [id_medida_prorrogada, id_medida_prorrogada, req.id_establecimiento]
      );
      if (original) {
        if (original.prorrogas_previas > 0)
          avisoProrroga = 'Esta medida ya tuvo una prórroga antes: la Circular 482 admite "una sola vez".';
        else if (dias_habiles && original.dias_habiles && Number(dias_habiles) > Number(original.dias_habiles))
          avisoProrroga = `La prórroga (${dias_habiles} días) supera el plazo original (${original.dias_habiles} días): la Circular 482 admite prorrogar "por el mismo plazo".`;
      }
    }

    await conn.beginTransaction();

    const [r] = await conn.query(
      // Esta medida cuelga del registro y no del caso, así que el involucrado
      // solo se puede resolver cuando viene atada a un paso: de ahí se llega al
      // caso y de ahí a la persona. Sin paso queda en NULL, como debe ser.
      `INSERT INTO MEDIDA_DISCIPLINARIA
         (descripcion, fundamento, tipo_medida, dias_habiles, fecha_aplicacion, fecha_termino,
          fecha_revision, es_prorroga, id_medida_prorrogada,
          id_registro, id_estudiante, id_involucrado,
          id_establecimiento, id_usuario, id_activado_paso)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               (SELECT i.id_involucrado
                FROM PROTOCOLO_ACTIVADO_PASO p
                JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i
                  ON i.id_protocolo_activado = p.id_protocolo_activado AND i.id_estudiante = ?
                WHERE p.id_activado_paso = ? LIMIT 1),
               ?, ?, ?)`,
      [descripcion.trim(), fundamento?.trim() || null, tipo || 'otra', dias_habiles || null,
       fecha_aplicacion, fecha_termino, fecha_revision || null,
       es_prorroga ? 1 : 0, id_medida_prorrogada || null,
       req.params.id, id_estudiante || null, id_estudiante || null, id_activado_paso || null,
       req.id_establecimiento, req.user.id, id_activado_paso || null]
    );

    await conn.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, id_activado_paso, tipo_evento, descripcion, id_usuario, fecha)
       SELECT p.id_protocolo_activado, ?, ?, 'medida_disciplinaria_aplicada', ?, ?, NOW()
       FROM PROTOCOLO_ACTIVADO_PASO p WHERE p.id_activado_paso = ?`,
      [req.id_establecimiento, id_activado_paso || null,
       `${tipo || 'otra'}${fecha_termino ? ` hasta el ${fecha_termino}` : ''}`,
       req.user.id, id_activado_paso || null]
    );

    await conn.commit();
    res.status(201).json({
      id_medida: r.insertId, fecha_termino, aviso: avisoProrroga,
      message: 'Medida disciplinaria registrada',
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al registrar la medida disciplinaria' });
  } finally {
    conn.release();
  }
};

// PATCH /api/medidas-disciplinarias/:id/resultado
const registrarResultado = async (req, res) => {
  const { resultado, fecha_resultado } = req.body;

  if (!resultado?.trim())
    return res.status(400).json({ message: 'El resultado es requerido' });

  try {
    const [r] = await pool.query(
      `UPDATE MEDIDA_DISCIPLINARIA
       SET resultado = ?, fecha_resultado = ?
       WHERE id_medida = ? AND id_establecimiento = ?`,
      [resultado.trim(), fecha_resultado || new Date().toISOString().slice(0, 10),
       req.params.id, req.id_establecimiento]
    );
    if (r.affectedRows === 0) return res.status(404).json({ message: 'Medida no encontrada' });
    res.json({ message: 'Resultado registrado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al registrar el resultado' });
  }
};

module.exports = { getByRegistro, crear, registrarResultado, TIPOS_MEDIDA, TIPOS_CON_PLAZO };
