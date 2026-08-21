const router = require('express').Router();
const { getAll, create, update, remove } = require('../controllers/comunas.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken);

router.get('/',       getAll);                            // ambos roles
router.post('/',      requirePermission(Permiso.ComunaCrear), create);
router.put('/:id',    requirePermission(Permiso.ComunaEditar), update);
router.delete('/:id', requirePermission(Permiso.ComunaEliminar), remove);

module.exports = router;
