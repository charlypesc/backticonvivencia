const router = require('express').Router();
const { getAll, create, remove } = require('../controllers/feriados.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

// Sin resolverScope: los feriados son globales, no por establecimiento. Todo
// usuario autenticado puede leerlos (los necesita para entender una fecha
// límite); administrarlos requiere permiso.
router.use(verifyToken);

router.get   ('/',    getAll);
router.post  ('/',    requirePermission(Permiso.FeriadoAdministrar), create);
router.delete('/:id', requirePermission(Permiso.FeriadoAdministrar), remove);

module.exports = router;
