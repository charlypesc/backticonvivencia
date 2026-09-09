const pool = require('../db/connection');
const { puedeVerConfidencial } = require('../utils/confidencial');

// Ocultar el contenido en las lecturas no alcanza: sin esto, quien no puede ver
// un registro confidencial igual podía editarlo o borrarlo a ciegas
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
      `SELECT r.*, u.nombre AS autor_nombre, u.correo AS autor_correo,
              um.nombre AS editor_nombre, um.correo AS editor_correo,
              -- Firma de los estudiantes involucrados ("12:afectado,30:testigo").
              -- Viaja en esta misma consulta porque no cuesta un viaje extra a
              -- la base y le permite al update saltarse el DELETE+INSERT de
              -- involucrados —y con eso la transacción entera— cuando la
              -- edición no los tocó, que es el caso habitual. El formato tiene
              -- que coincidir con firmaInvolucrados() de registros.controller.
              (SELECT GROUP_CONCAT(CONCAT(re.id_estudiante, ':', re.rol_en_incidente)
                                   ORDER BY re.id_estudiante SEPARATOR ',')
                 FROM REGISTRO_ESTUDIANTE re
                WHERE re.id_registro = r.id_registro) AS involucrados_firma,
              -- No hay firma equivalente para el denunciante/involucrado que no
              -- es estudiante (un 'externo' no tiene una llave estable antes de
              -- guardarse la primera vez): con el conteo alcanza para que
              -- update() sepa que tiene que ir por la transacción en vez del
              -- atajo de un solo UPDATE. Ver registros.controller.js.
              (SELECT COUNT(*) FROM REGISTRO_INVOLUCRADO_NO_ESTUDIANTE rine
                WHERE rine.id_registro = r.id_registro) AS involucrados_personal_count
       FROM REGISTRO_CONVIVENCIA r
       JOIN USUARIO u ON r.id_usuario = u.id_usuario
       LEFT JOIN USUARIO um ON r.id_usuario_modificacion = um.id_usuario
       WHERE r.id_registro = ?`,
      [id]
    );

    // Un registro de otro colegio se responde como inexistente, igual que en
    // la lectura por id. Va acá porque este middleware es el paso común de
    // todas las escrituras de registros (editar, eliminar, confirmar).
    if (!registro || registro.id_establecimiento !== req.id_establecimiento)
      return res.status(404).json({ message: 'Registro no encontrado' });

    if (registro.es_confidencial && !puedeVerConfidencial(req, registro))
      return res.status(403).json({
        message: 'Este registro es confidencial',
        nota_confidencial: registro.nota_confidencial,
        autor_correo: registro.autor_correo,
        autor_nombre: registro.autor_nombre,
        fecha_creacion: registro.fecha_creacion,
        editor_correo: registro.editor_correo,
        editor_nombre: registro.editor_nombre,
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
