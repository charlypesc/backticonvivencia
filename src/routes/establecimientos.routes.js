const router = require('express').Router();
const { getAll, getById, create, update, remove } = require('../controllers/establecimiento.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken);

router.get('/',       getAll);                             // ambos roles
router.get('/:id',    getById);                             // ambos roles
router.post('/',      requirePermission(Permiso.EstablecimientoCrear), create);
router.put('/:id',    requirePermission(Permiso.EstablecimientoEditar), update);
router.delete('/:id', requirePermission(Permiso.EstablecimientoEliminar), remove);

module.exports = router;
