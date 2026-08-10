const pool = require('../db/connection');

const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM CATALOGO_PROTOCOLOS_GENERICOS ORDER BY nombre`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al obtener protocolos genéricos' });
  }
};

const create = async (req, res) => {
  const { nombre, descripcion } = req.body;

  if (!nombre)
    return res.status(400).json({ message: 'Nombre es requerido' });

  try {
    const [result] = await pool.query(
      `INSERT INTO CATALOGO_PROTOCOLOS_GENERICOS (nombre, descripcion)
       VALUES (?, ?)`,
      [nombre, descripcion || null]
    );
    res.status(201).json({ id_protocolo: result.insertId, message: 'Protocolo genérico creado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al crear protocolo genérico' });
  }
};

const update = async (req, res) => {
  const { nombre, descripcion } = req.body;

  try {
    await pool.query(
      `UPDATE CATALOGO_PROTOCOLOS_GENERICOS SET nombre=?, descripcion=?
       WHERE id_protocolo = ?`,
      [nombre, descripcion, req.params.id]
    );
    res.json({ message: 'Protocolo genérico actualizado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error al actualizar' });
  }
};

const remove = async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM CATALOGO_PROTOCOLOS_GENERICOS WHERE id_protocolo = ?`,
      [req.params.id]
    );
    res.json({ message: 'Protocolo genérico eliminado' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2')
      return res.status(409).json({
        message: 'No es posible eliminar un protocolo genérico en uso. Reasigne los protocolos de establecimiento asociados primero.'
      });
    console.error(err);
    res.status(500).json({ message: 'Error al eliminar' });
  }
};

module.exports = { getAll, create, update, remove };
