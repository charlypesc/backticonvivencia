const pool = require('../db/connection');
const { invalidarCache } = require('../services/feriados.service');

// Mantenedor del calendario de feriados.
//
// Es lo que define qué días son hábiles, así que de acá dependen los plazos
// legales: los 15 días hábiles de la suspensión y los 5 para informar a la
// Superintendencia y a la SEREMI. Por eso tiene permiso propio y no se edita
// desde ningún otro módulo.
//
// Un feriado con id_region NULL es nacional; con valor, rige solo en esa región.
// La tabla es global (no por establecimiento): los feriados no los define cada
// colegio.

const getAll = async (req, res) => {
  const anio = req.query.anio;
  try {
    const [filas] = await pool.query(
      `SELECT f.*, r.nombre AS region_nombre
       FROM FERIADO f
       LEFT JOIN REGION r ON r.id_region = f.id_region
       ${anio ? 'WHERE YEAR(f.fecha) = ?' : ''}
       ORDER BY f.fecha`,
      anio ? [anio] : []
    );
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener los feriados' });
  }
};

const create = async (req, res) => {
  const { fecha, nombre, tipo, irrenunciable, id_region } = req.body;

  if (!fecha || !nombre?.trim())
    return res.status(400).json({ message: 'fecha y nombre son requeridos' });

  try {
    const [r] = await pool.query(
      'INSERT INTO FERIADO (fecha, nombre, tipo, irrenunciable, id_region) VALUES (?, ?, ?, ?, ?)',
      [fecha, nombre.trim(), tipo || 'civil', irrenunciable ? 1 : 0, id_region || null]
    );
    // Sin esto, el proceso sigue calculando con el calendario viejo hasta que
    // vence el TTL del caché: una hora de fechas límite mal calculadas.
    invalidarCache();
    res.status(201).json({ id_feriado: r.insertId, message: 'Feriado creado' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ message: 'Ya existe un feriado para esa fecha y ese alcance' });
    console.error(err);
    res.status(500).json({ message: 'Error al crear el feriado' });
  }
};

const remove = async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM FERIADO WHERE id_feriado = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ message: 'Feriado no encontrado' });
    invalidarCache();
    res.json({ message: 'Feriado eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar el feriado' });
  }
};

module.exports = { getAll, create, remove };
