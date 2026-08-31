const pool = require('../db/connection');

// Medidas disciplinarias aplicadas en un caso, con su resultado.
//
// La tabla MEDIDA_DISCIPLINARIA existía desde antes pero nunca se usó. Se
// retoma porque el informe previo de expulsión (art. 2 N° 5 de la Ley 21.809)
// exige explicitar la aplicación de cada medida previa "con indicación de los
// resultados obtenidos". Sin `resultado` poblado, ese informe no se puede
// generar y hay que escribirlo a mano desde cero.
//
// Por eso el resultado se registra en un segundo momento y no al aplicar la
// medida: cuando se aplica todavía no hay resultado que contar.

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
    res.json(medidas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener las medidas disciplinarias' });
  }
};

// POST /api/registros/:id/medidas-disciplinarias
const crear = async (req, res) => {
  const { descripcion, tipo_medida, fecha_aplicacion, id_estudiante, id_activado_paso } = req.body;

  if (!descripcion?.trim() || !fecha_aplicacion)
    return res.status(400).json({ message: 'descripcion y fecha_aplicacion son requeridos' });

  try {
    const [[registro]] = await pool.query(
      'SELECT id_registro FROM REGISTRO_CONVIVENCIA WHERE id_registro = ? AND id_establecimiento = ?',
      [req.params.id, req.id_establecimiento]
    );
    if (!registro) return res.status(404).json({ message: 'Registro no encontrado' });

    const [r] = await pool.query(
      // Esta medida cuelga del registro y no del caso, así que el involucrado
      // solo se puede resolver cuando viene atada a un paso: de ahí se llega al
      // caso y de ahí a la persona. Sin paso queda en NULL, como debe ser.
      `INSERT INTO MEDIDA_DISCIPLINARIA
         (descripcion, tipo_medida, fecha_aplicacion, id_registro, id_estudiante, id_involucrado,
          id_establecimiento, id_usuario, id_activado_paso)
       VALUES (?, ?, ?, ?, ?,
               (SELECT i.id_involucrado
                FROM PROTOCOLO_ACTIVADO_PASO p
                JOIN PROTOCOLO_ACTIVADO_INVOLUCRADO i
                  ON i.id_protocolo_activado = p.id_protocolo_activado AND i.id_estudiante = ?
                WHERE p.id_activado_paso = ? LIMIT 1),
               ?, ?, ?)`,
      [descripcion.trim(), tipo_medida?.trim() || null, fecha_aplicacion, req.params.id,
       id_estudiante || null, id_estudiante || null, id_activado_paso || null,
       req.id_establecimiento, req.user.id, id_activado_paso || null]
    );
    res.status(201).json({ id_medida: r.insertId, message: 'Medida disciplinaria registrada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al registrar la medida disciplinaria' });
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

module.exports = { getByRegistro, crear, registrarResultado };
