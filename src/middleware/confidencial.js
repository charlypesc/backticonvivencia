const pool = require('../db/connection');
const { puedeVerConfidencial } = require('../utils/confidencial');

// Ocultar el contenido en las lecturas no alcanza: sin esto, quien no puede ver
// un registro confidencial igual podía editarlo, validarlo o borrarlo a ciegas
// llamando al endpoint directo (el front no lo ofrece, pero la API sí lo
// aceptaba). Actuar sobre algo que no podés leer es el mismo problema de fondo.
//
// Deja el registro ya cargado en req.registroActual para que el controlador no
// tenga que volver a consultarlo.
const bloquearEscrituraConfidencial = async (req, res, next) => {
  try {
    // Las rutas de registros usan :id y la de documentos :id_registro.
    const id = req.params.id ?? req.params.id_registro;

    const [[registro]] = await pool.query(
      `SELECT r.*, u.correo AS autor_correo, um.correo AS editor_correo
       FROM REGISTRO_CONVIVENCIA r
       JOIN USUARIO u ON r.id_usuario = u.id_usuario
       LEFT JOIN USUARIO um ON r.id_usuario_modificacion = um.id_usuario
       WHERE r.id_registro = ?`,
      [id]
    );

    // Un registro de otro colegio se responde como inexistente, igual que en
    // la lectura por id. Va acá porque este middleware es el paso común de
    // todas las escrituras de registros (editar, validar, eliminar, confirmar).
    if (!registro || registro.id_establecimiento !== req.id_establecimiento)
      return res.status(404).json({ message: 'Registro no encontrado' });

    if (registro.es_confidencial && !puedeVerConfidencial(req, registro))
      return res.status(403).json({
        message: 'Este registro es confidencial',
        nota_confidencial: registro.nota_confidencial,
        autor_correo: registro.autor_correo,
        fecha_creacion: registro.fecha_creacion,
        editor_correo: registro.editor_correo,
        fecha_modificacion: registro.fecha_modificacion,
      });

    req.registroActual = registro;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al verificar el registro' });
  }
};

module.exports = { bloquearEscrituraConfidencial };
