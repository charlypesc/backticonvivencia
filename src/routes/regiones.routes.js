const router = require('express').Router();
const { getAll, create, update, remove } = require('../controllers/regiones.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken);

router.get('/',       getAll);                            // ambos roles
router.post('/',      requirePermission(Permiso.RegionCrear), create);
router.put('/:id',    requirePermission(Permiso.RegionEditar), update);
router.delete('/:id', requirePermission(Permiso.RegionEliminar), remove);

module.exports = router;
