const pool = require('../db/connection');

// Plantillas de los correos de contacto comercial que se copian desde la ficha
// de un establecimiento en Geo: 1 presentación, 2 recordatorio, 3 nueva
// promoción. Son fijas (siempre las mismas tres filas, sembradas en la BD):
// acá solo se leen y se editan, no se crean ni se borran.
//
// En asunto y cuerpo, `{colegio}` se reemplaza en el front por el nombre del
// establecimiento al copiar.

const LARGO_MAX_ASUNTO = 255;
const LARGO_MAX_CUERPO = 20000;

const listar = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id_plantilla_correo, nombre, asunto, cuerpo, actualizado_en
         FROM PLANTILLA_CORREO
        ORDER BY id_plantilla_correo`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener las plantillas de correo' });
  }
};

const actualizar = async (req, res) => {
  const asunto = String(req.body.asunto ?? '').trim();
  const cuerpo = String(req.body.cuerpo ?? '').trim();
  if (!asunto || !cuerpo)
    return res.status(400).json({ message: 'El asunto y el cuerpo son obligatorios' });
  if (asunto.length > LARGO_MAX_ASUNTO)
    return res.status(400).json({ message: `El asunto no puede superar los ${LARGO_MAX_ASUNTO} caracteres` });
  if (cuerpo.length > LARGO_MAX_CUERPO)
    return res.status(400).json({ message: 'El cuerpo del correo es demasiado largo' });

  try {
    const [r] = await pool.query(
      `UPDATE PLANTILLA_CORREO SET asunto = ?, cuerpo = ? WHERE id_plantilla_correo = ?`,
      [asunto, cuerpo, req.params.id]
    );
    if (r.affectedRows === 0)
      return res.status(404).json({ message: 'Plantilla no encontrada' });

    const [[fila]] = await pool.query(
      `SELECT id_plantilla_correo, nombre, asunto, cuerpo, actualizado_en
         FROM PLANTILLA_CORREO WHERE id_plantilla_correo = ?`,
      [req.params.id]
    );
    res.json({ plantilla: fila, message: 'Plantilla guardada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al guardar la plantilla' });
  }
};

module.exports = { listar, actualizar };
