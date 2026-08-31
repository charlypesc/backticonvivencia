const pool = require('../db/connection');
const { calcularFechaLimite } = require('../utils/flujoProtocolo');
const { cargarFeriados } = require('../services/feriados.service');

// Informe previo de expulsión o cancelación de matrícula.
//
// Es el único documento con contenido tasado en toda la Ley 21.809 (art. 2 N° 5,
// que modifica el DFL 2/1998). Por eso acá los campos no son texto libre a
// gusto del colegio: son los que la norma enumera, y `emitir` no deja cerrar el
// informe si falta alguno.
//
// Lo elabora una comisión de tres: profesor jefe, coordinador de convivencia y
// un integrante del equipo técnico pedagógico. Los tres tienen que firmar.
//
// El contenido se precarga desde la bitácora del caso — de ahí sale el valor
// real del sistema: la parte más laboriosa del informe ("cada medida aplicada
// con indicación de los resultados obtenidos") ya está registrada.

const DIAS_HABILES_INFORME = 5;

const ROLES_COMISION = ['profesor_jefe', 'coordinador_convivencia', 'equipo_tecnico_pedagogico'];

// Campos que la ley enumera y sin los cuales el informe no está completo.
const CAMPOS_EXIGIDOS = [
  ['antecedentes_conductuales',    'antecedentes conductuales'],
  ['antecedentes_pedagogicos',     'antecedentes pedagógicos'],
  ['proporcionalidad',             'proporcionalidad de la medida'],
  ['gravedad_afectacion',          'gravedad de la afectación a la convivencia'],
  ['medidas_previas_insuficientes','fundamentación de por qué las medidas previas fueron insuficientes'],
  ['constancia_alternativas',      'constancia de que se agotaron las alternativas pedagógicas y formativas'],
];

const buscarInforme = async (db, id_informe, id_establecimiento) => {
  const [[informe]] = await db.query(
    'SELECT * FROM INFORME_EXPULSION WHERE id_informe = ? AND id_establecimiento = ?',
    [id_informe, id_establecimiento]
  );
  return informe ?? null;
};

const comisionDe = (db, id_informe) =>
  db.query(
    `SELECT c.*, u.correo
     FROM INFORME_EXPULSION_COMISION c
     JOIN USUARIO u ON u.id_usuario = c.id_usuario
     WHERE c.id_informe = ?`,
    [id_informe]
  ).then(([filas]) => filas);

// GET /api/protocolos-activados/:id/informe-expulsion
const getByCaso = async (req, res) => {
  try {
    const [[informe]] = await pool.query(
      `SELECT ie.*, e.nombre AS estudiante_nombre, e.apellido AS estudiante_apellido, e.run, e.dv
       FROM INFORME_EXPULSION ie
       JOIN ESTUDIANTE e ON e.id_estudiante = ie.id_estudiante
       WHERE ie.id_protocolo_activado = ? AND ie.id_establecimiento = ?`,
      [req.params.id, req.id_establecimiento]
    );
    if (!informe) return res.status(404).json({ message: 'Este caso no tiene informe de expulsión' });

    const comision = await comisionDe(pool, informe.id_informe);

    // Las medidas previas van siempre en la respuesta, estén o no volcadas al
    // texto: son la evidencia de la que el informe tiene que dar cuenta.
    const [medidas] = await pool.query(
      `SELECT md.descripcion, md.tipo_medida, md.fecha_aplicacion, md.resultado, md.fecha_resultado
       FROM MEDIDA_DISCIPLINARIA md
       WHERE md.id_registro = ? ORDER BY md.fecha_aplicacion`,
      [informe.id_registro]
    );

    res.json({
      ...informe,
      comision,
      medidas_previas: medidas,
      // Sin resultado no sirven para el informe: la ley pide "con indicación de
      // los resultados obtenidos", no el listado de lo aplicado.
      medidas_sin_resultado: medidas.filter((m) => !m.resultado).length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener el informe' });
  }
};

// POST /api/protocolos-activados/:id/informe-expulsion
const crear = async (req, res) => {
  const { id_estudiante, medida } = req.body;

  if (!id_estudiante || !medida)
    return res.status(400).json({ message: 'id_estudiante y medida son requeridos' });
  if (!['expulsion', 'cancelacion_matricula'].includes(medida))
    return res.status(400).json({ message: 'medida debe ser expulsion o cancelacion_matricula' });

  try {
    const [[caso]] = await pool.query(
      `SELECT id_protocolo_activado, id_registro FROM PROTOCOLO_ACTIVADO
       WHERE id_protocolo_activado = ? AND id_establecimiento = ?`,
      [req.params.id, req.id_establecimiento]
    );
    if (!caso) return res.status(404).json({ message: 'Caso no encontrado' });

    const [[ya]] = await pool.query(
      'SELECT id_informe FROM INFORME_EXPULSION WHERE id_protocolo_activado = ?',
      [req.params.id]
    );
    if (ya) return res.status(409).json({ message: 'El caso ya tiene un informe', id_informe: ya.id_informe });

    const [r] = await pool.query(
      // Un caso con dos señalados puede terminar en expulsión de uno solo: el
      // informe queda atado al involucrado, no solo al estudiante.
      `INSERT INTO INFORME_EXPULSION
         (id_protocolo_activado, id_registro, id_establecimiento, id_estudiante, id_involucrado,
          medida, id_usuario_creacion)
       VALUES (?, ?, ?, ?,
               (SELECT id_involucrado FROM PROTOCOLO_ACTIVADO_INVOLUCRADO
                WHERE id_protocolo_activado = ? AND id_estudiante = ? LIMIT 1),
               ?, ?)`,
      [req.params.id, caso.id_registro, req.id_establecimiento, id_estudiante,
       req.params.id, id_estudiante, medida, req.user.id]
    );
    res.status(201).json({ id_informe: r.insertId, message: 'Informe iniciado en borrador' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear el informe' });
  }
};

// PUT /api/informes-expulsion/:id
const actualizar = async (req, res) => {
  const campos = [
    'antecedentes_conductuales', 'antecedentes_pedagogicos', 'informes_psicosociales',
    'proporcionalidad', 'gravedad_afectacion', 'medidas_previas_insuficientes',
    'constancia_alternativas', 'recomendacion', 'fundamento_recomendacion',
  ];

  try {
    const informe = await buscarInforme(pool, req.params.id, req.id_establecimiento);
    if (!informe) return res.status(404).json({ message: 'Informe no encontrado' });
    // Un informe emitido es el documento que se acompañó a la decisión: editarlo
    // después dejaría el expediente diciendo algo distinto de lo que se firmó.
    if (informe.estado === 'emitido')
      return res.status(409).json({ message: 'El informe ya fue emitido y no se puede editar' });

    const sets = campos.filter((c) => c in req.body);
    if (sets.length === 0) return res.status(400).json({ message: 'Nada que actualizar' });

    await pool.query(
      `UPDATE INFORME_EXPULSION SET ${sets.map((c) => `${c} = ?`).join(', ')} WHERE id_informe = ?`,
      [...sets.map((c) => req.body[c] ?? null), req.params.id]
    );
    res.json({ message: 'Informe actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar el informe' });
  }
};

// PUT /api/informes-expulsion/:id/comision
const reemplazarComision = async (req, res) => {
  const { integrantes } = req.body;

  if (!Array.isArray(integrantes))
    return res.status(400).json({ message: 'integrantes debe ser un arreglo' });

  const conn = await pool.getConnection();
  try {
    const informe = await buscarInforme(conn, req.params.id, req.id_establecimiento);
    if (!informe) return res.status(404).json({ message: 'Informe no encontrado' });
    if (informe.estado === 'emitido')
      return res.status(409).json({ message: 'El informe ya fue emitido' });

    for (const i of integrantes)
      if (!ROLES_COMISION.includes(i.rol_comision))
        return res.status(400).json({
          message: `rol_comision inválido: ${i.rol_comision}. Debe ser uno de ${ROLES_COMISION.join(', ')}`,
        });

    await conn.beginTransaction();
    await conn.query('DELETE FROM INFORME_EXPULSION_COMISION WHERE id_informe = ?', [req.params.id]);
    if (integrantes.length > 0)
      await conn.query(
        'INSERT INTO INFORME_EXPULSION_COMISION (id_informe, id_usuario, rol_comision) VALUES ?',
        [integrantes.map((i) => [req.params.id, i.id_usuario, i.rol_comision])]
      );
    await conn.commit();
    res.json({ message: 'Comisión actualizada' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar la comisión' });
  } finally {
    conn.release();
  }
};

// POST /api/informes-expulsion/:id/firmar
// Firma el integrante autenticado. No se puede firmar por otro: la comisión es
// personal y su firma es lo que sostiene el informe.
const firmar = async (req, res) => {
  try {
    const informe = await buscarInforme(pool, req.params.id, req.id_establecimiento);
    if (!informe) return res.status(404).json({ message: 'Informe no encontrado' });
    if (informe.estado === 'emitido')
      return res.status(409).json({ message: 'El informe ya fue emitido' });

    const [r] = await pool.query(
      `UPDATE INFORME_EXPULSION_COMISION SET fecha_firma = NOW()
       WHERE id_informe = ? AND id_usuario = ?`,
      [req.params.id, req.user.id]
    );
    if (r.affectedRows === 0)
      return res.status(403).json({ message: 'No integrás la comisión de este informe' });

    res.json({ message: 'Informe firmado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al firmar el informe' });
  }
};

// POST /api/informes-expulsion/:id/emitir
const emitir = async (req, res) => {
  try {
    const informe = await buscarInforme(pool, req.params.id, req.id_establecimiento);
    if (!informe) return res.status(404).json({ message: 'Informe no encontrado' });
    if (informe.estado === 'emitido')
      return res.status(409).json({ message: 'El informe ya fue emitido' });

    const faltan = CAMPOS_EXIGIDOS.filter(([campo]) => !informe[campo]?.trim()).map(([, texto]) => texto);
    if (!informe.recomendacion) faltan.push('la recomendación de aplicar o no la medida');

    const comision = await comisionDe(pool, req.params.id);
    for (const rol of ROLES_COMISION) {
      const integrante = comision.find((c) => c.rol_comision === rol);
      if (!integrante) faltan.push(`el integrante de la comisión con rol ${rol}`);
      else if (!integrante.fecha_firma) faltan.push(`la firma de ${integrante.correo} (${rol})`);
    }

    if (faltan.length > 0)
      return res.status(409).json({
        message: 'El informe no está completo según el contenido que exige la ley',
        faltan,
      });

    await pool.query(
      `UPDATE INFORME_EXPULSION SET estado = 'emitido', fecha_emision = NOW() WHERE id_informe = ?`,
      [req.params.id]
    );
    await pool.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES (?, ?, 'informe_expulsion_emitido', ?, ?, NOW())`,
      [informe.id_protocolo_activado, req.id_establecimiento,
       `Informe previo emitido, recomendación: ${informe.recomendacion}`, req.user.id]
    );
    res.json({ message: 'Informe emitido' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al emitir el informe' });
  }
};

// POST /api/informes-expulsion/:id/decidir
//
// La resuelve el director. Si el informe NO recomienda la medida y el director
// la aplica igual, la ley lo obliga a fundamentar de forma pormenorizada: acá
// eso es un requisito de la petición, no una advertencia que se pueda ignorar.
const decidir = async (req, res) => {
  const { decision, fundamento_director, fecha_notificacion_apoderado } = req.body;

  if (!['aplica', 'no_aplica'].includes(decision))
    return res.status(400).json({ message: 'decision debe ser aplica o no_aplica' });

  try {
    const informe = await buscarInforme(pool, req.params.id, req.id_establecimiento);
    if (!informe) return res.status(404).json({ message: 'Informe no encontrado' });
    if (informe.estado !== 'emitido')
      return res.status(409).json({ message: 'El informe todavía no fue emitido' });
    if (informe.decision_director !== 'pendiente')
      return res.status(409).json({ message: 'La medida ya fue resuelta' });

    const contradice = decision === 'aplica' && informe.recomendacion === 'no_aplicar';
    if (contradice && !fundamento_director?.trim())
      return res.status(409).json({
        message:
          'El informe no recomienda la medida: para aplicarla igual hay que indicar de forma ' +
          'pormenorizada los fundamentos de la decisión.',
        requiere_fundamento: true,
      });

    // El plazo de 5 días hábiles para informar a la Superintendencia y a la
    // SEREMI corre desde la notificación al apoderado, no desde la decisión.
    let fecha_limite_informes = null;
    if (decision === 'aplica' && fecha_notificacion_apoderado) {
      const feriados = await cargarFeriados(req.id_establecimiento);
      fecha_limite_informes = calcularFechaLimite(
        new Date(fecha_notificacion_apoderado + 'T12:00:00Z'),
        DIAS_HABILES_INFORME, 'dias_habiles', feriados
      ).toISOString().slice(0, 10);
    }

    await pool.query(
      `UPDATE INFORME_EXPULSION
       SET decision_director = ?, fundamento_director = ?, fecha_decision = NOW(),
           fecha_notificacion_apoderado = ?, fecha_limite_informes = ?
       WHERE id_informe = ?`,
      [decision, fundamento_director?.trim() || null,
       fecha_notificacion_apoderado || null, fecha_limite_informes, req.params.id]
    );
    await pool.query(
      `INSERT INTO PROTOCOLO_ACTIVADO_EVENTO
         (id_protocolo_activado, id_establecimiento, tipo_evento, descripcion, id_usuario, fecha)
       VALUES (?, ?, 'expulsion_resuelta', ?, ?, NOW())`,
      [informe.id_protocolo_activado, req.id_establecimiento,
       `El director resolvió: ${decision}${contradice ? ' (contra la recomendación del informe)' : ''}`,
       req.user.id]
    );

    res.json({ message: 'Decisión registrada', fecha_limite_informes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al registrar la decisión' });
  }
};

// PATCH /api/informes-expulsion/:id/informes-enviados
const registrarEnvios = async (req, res) => {
  const { fecha_informe_superintendencia, fecha_informe_seremi } = req.body;

  try {
    const informe = await buscarInforme(pool, req.params.id, req.id_establecimiento);
    if (!informe) return res.status(404).json({ message: 'Informe no encontrado' });

    await pool.query(
      `UPDATE INFORME_EXPULSION
       SET fecha_informe_superintendencia = COALESCE(?, fecha_informe_superintendencia),
           fecha_informe_seremi           = COALESCE(?, fecha_informe_seremi)
       WHERE id_informe = ?`,
      [fecha_informe_superintendencia || null, fecha_informe_seremi || null, req.params.id]
    );
    res.json({ message: 'Envíos registrados' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al registrar los envíos' });
  }
};

module.exports = {
  getByCaso, crear, actualizar, reemplazarComision, firmar, emitir, decidir, registrarEnvios,
  DIAS_HABILES_INFORME, ROLES_COMISION,
};
