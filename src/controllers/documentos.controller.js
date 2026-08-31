const db = require('../db/connection');
const { procesarDocumento } = require('../services/documentai.service');
const { estructurarTextoOCR } = require('../services/gemini.service');
const { normalizarImagen } = require('../utils/imagen');
const { comprimirArchivo } = require('../utils/comprimirArchivo');

// Tope de la API de Document AI para procesamiento sincrónico. No es una regla
// nuestra: es el límite del servicio al que le mandamos el archivo.
const LIMITE_DOCUMENT_AI = 20 * 1024 * 1024;

const subirDocumento = async (req, res) => {
  if (!req.file) return res.status(400).json({ mensaje: 'No se recibió archivo' });
console.log('llegando al EP')
  if (req.user?.id_establecimiento == null) {
    return res.status(400).json({
      mensaje: 'El token no contiene id_establecimiento. Vuelve a iniciar sesión para obtener un token actualizado.',
    });
  }

  try {
    // console.log('llego al try')
    const conn = await db.getConnection();
    await conn.beginTransaction();
    // 1. Catálogos del establecimiento (necesarios para crear el registro mínimo y para el LLM)
    const [tiposFalta] = await conn.query(
      'SELECT id_tipo_falta, nombre FROM TIPO_FALTA WHERE id_establecimiento = ?',
      [req.id_establecimiento]
    );
    // console.log('pase a la primera qry')
    // console.log(tiposFalta)

    if (tiposFalta.length === 0) {
      // Salir sin liberar la conexión la deja tomada para siempre: con el pool
      // en 10, diez subidas de un colegio sin tipos de falta configurados
      // cuelgan todo el servidor, no solo esta pantalla.
      await conn.rollback();
      conn.release();
      return res.status(400).json({ mensaje: 'El establecimiento no tiene tipos de falta configurados' });
    }

    const [estudiantes] = await conn.query(
      'SELECT id_estudiante, nombre, apellido FROM ESTUDIANTE WHERE id_establecimiento = ? AND activo = 1',
      [req.id_establecimiento]
    );
// console.log([estudiantes])
// console.log('pase estudiante')
    // 2. Document AI → texto crudo (HEIC de iPhone se convierte a JPEG antes)
    let { buffer: bufferOCR, mimetype: mimetypeOCR } = await normalizarImagen(
      req.file.buffer, req.file.mimetype, req.file.originalname
    );

    // El acta NO se comprime salvo que haga falta, al revés que el resto de los
    // adjuntos. Acá el archivo no se guarda —de él solo queda el texto que
    // devuelve el OCR—, así que comprimir no ahorra nada y sí puede costar
    // precisión al leer una letra manuscrita. La compresión entra solo para
    // rescatar un archivo que Document AI rechazaría por tamaño: entre perder
    // algo de nitidez y no poder digitalizar el acta, conviene lo primero.
    if (bufferOCR.length > LIMITE_DOCUMENT_AI) {
      const comprimido = await comprimirArchivo({
        buffer: bufferOCR, mimetype: mimetypeOCR, originalname: req.file.originalname,
      });
      bufferOCR = comprimido.buffer;
      mimetypeOCR = comprimido.mimetype;

      if (bufferOCR.length > LIMITE_DOCUMENT_AI) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({
          mensaje:
            'El archivo es demasiado grande para procesarlo aunque se comprimió. ' +
            'Probá subiendo las páginas por separado o una foto en vez del PDF completo.',
        });
      }
    }

    const { texto, nivelConfianza } = await procesarDocumento(bufferOCR, mimetypeOCR);

    // 3. LLM → estructura JSON con IDs ya resueltos contra los catálogos
    const datosEstructurados = await estructurarTextoOCR(texto, tiposFalta, estudiantes);

    try {

      // 4. Crear el registro de convivencia con datos mínimos (placeholder, se completa abajo)
      const [registroResult] = await conn.query(
        `INSERT INTO REGISTRO_CONVIVENCIA
          (fecha_incidente, asunto, antecedentes, id_tipo_falta, id_usuario, id_establecimiento)
         VALUES (CURDATE(), 'Pendiente de revisión', 'Generado automáticamente desde documento digitalizado', ?, ?, ?)`,
        [tiposFalta[0].id_tipo_falta, req.user.id, req.id_establecimiento]
      );
      const id_registro = registroResult.insertId;

      // 5. Guardar documento digitalizado
      const [docResult] = await conn.query(
        `INSERT INTO DOCUMENTO_DIGITALIZADO
          (url_archivo, tipo_archivo, fecha_subida, nivel_confianza, id_registro)
         VALUES (?, ?, NOW(), ?, ?)`,
        [texto, mimetypeOCR, nivelConfianza, id_registro]
      );

      // 6. Actualizar el registro con los datos estructurados por el LLM
      const {
        fecha_incidente, asunto, antecedentes, acuerdos,
        id_tipo_falta, estudiantes: estudiantesDetectados,
      } = datosEstructurados;

      await conn.query(
        `UPDATE REGISTRO_CONVIVENCIA
         SET fecha_incidente = COALESCE(?, fecha_incidente),
             asunto = COALESCE(?, asunto),
             antecedentes = COALESCE(?, antecedentes),
             acuerdos = COALESCE(?, acuerdos),
             id_tipo_falta = COALESCE(?, id_tipo_falta)
         WHERE id_registro = ?`,
        [fecha_incidente, asunto, antecedentes, acuerdos, id_tipo_falta, id_registro]
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