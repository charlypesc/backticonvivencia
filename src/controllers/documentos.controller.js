const db = require('../db/connection');
const { procesarDocumento } = require('../services/documentai.service');
const { estructurarTextoOCR } = require('../services/gemini.service');

const subirDocumento = async (req, res) => {
  if (!req.file) return res.status(400).json({ mensaje: 'No se recibió archivo' });
console.log('llegando al EP')
  if (req.user?.id_establecimiento == null) {
    return res.status(400).json({
      mensaje: 'El token no contiene id_establecimiento. Vuelve a iniciar sesión para obtener un token actualizado.',
    });
  }

  try {
    console.log('llego al try')
    const conn = await db.getConnection();
    await conn.beginTransaction();
    // 1. Catálogos del establecimiento (necesarios para crear el registro mínimo y para el LLM)
    const [tiposFalta] = await conn.query(
      'SELECT id_tipo_falta, nombre FROM TIPO_FALTA WHERE id_establecimiento = ?',
      [req.user.id_establecimiento]
    );
    console.log('pase a la primera qry')
    console.log(tiposFalta)

    if (tiposFalta.length === 0) {
      return res.status(400).json({ mensaje: 'El establecimiento no tiene tipos de falta configurados' });
    }

    const [estudiantes] = await conn.query(
      'SELECT id_estudiante, nombre, apellido FROM ESTUDIANTE WHERE id_establecimiento = ? AND activo = 1',
      [req.user.id_establecimiento]
    );
console.log([estudiantes])
// console.log('pase estudiante')
    // 2. Document AI → texto crudo
    const { texto, nivelConfianza } = await procesarDocumento(req.file.buffer, req.file.mimetype);

    // 3. LLM → estructura JSON con IDs ya resueltos contra los catálogos
    const datosEstructurados = await estructurarTextoOCR(texto, tiposFalta, estudiantes);

    try {

      // 4. Crear el registro de convivencia con datos mínimos (placeholder, se completa abajo)
      const [registroResult] = await conn.query(
        `INSERT INTO REGISTRO_CONVIVENCIA
          (fecha_incidente, tematica, antecedentes, id_tipo_falta, id_usuario)
         VALUES (CURDATE(), 'Pendiente de revisión', 'Generado automáticamente desde documento digitalizado', ?, ?)`,
        [tiposFalta[0].id_tipo_falta, req.user.id]
      );
      const id_registro = registroResult.insertId;

      // 5. Guardar documento digitalizado
      const [docResult] = await conn.query(
        `INSERT INTO documento_digitalizado
          (url_archivo, tipo_archivo, fecha_subida, nivel_confianza, id_registro)
         VALUES (?, ?, NOW(), ?, ?)`,
        [texto, req.file.mimetype, nivelConfianza, id_registro]
      );

      // 6. Actualizar el registro con los datos estructurados por el LLM
      const {
        fecha_incidente, tematica, antecedentes, acuerdos,
        id_tipo_falta, estudiantes: estudiantesDetectados,
      } = datosEstructurados;

      await conn.query(
        `UPDATE REGISTRO_CONVIVENCIA
         SET fecha_incidente = COALESCE(?, fecha_incidente),
             tematica = COALESCE(?, tematica),
             antecedentes = COALESCE(?, antecedentes),
             acuerdos = COALESCE(?, acuerdos),
             id_tipo_falta = COALESCE(?, id_tipo_falta)
         WHERE id_registro = ?`,
        [fecha_incidente, tematica, antecedentes, acuerdos, id_tipo_falta, id_registro]
      );

      const estudiantesConId = (estudiantesDetectados || []).filter(e => e.id_estudiante);
      if (estudiantesConId.length > 0) {
        const values = estudiantesConId.map(e => [id_registro, e.id_estudiante, e.rol_en_incidente || null]);
        await conn.query(
          'INSERT INTO REGISTRO_ESTUDIANTE (id_registro, id_estudiante, rol_en_incidente) VALUES ?',
          [values]
        );
      }

      await conn.commit();

      res.status(201).json({
        mensaje: 'Documento procesado y registro creado correctamente',
        id_registro,
        id_documento: docResult.insertId,
        nivel_confianza: nivelConfianza,
        texto_crudo: texto,
        datos_estructurados: datosEstructurados,
      });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('Error procesamiento:', error);
    res.status(500).json({ mensaje: 'Error al procesar documento', detalle: error.message });
  }
};

const obtenerPorRegistro = async (req, res) => {
  try {
    const { id_registro } = req.params;
    const [rows] = await db.execute(
      'SELECT * FROM documento_digitalizado WHERE id_registro = ?',
      [id_registro]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ mensaje: 'Error al obtener documentos' });
  }
};

module.exports = { subirDocumento, obtenerPorRegistro };