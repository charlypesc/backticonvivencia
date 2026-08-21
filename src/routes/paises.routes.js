const router = require('express').Router();
const { getAll, create, update, remove } = require('../controllers/paises.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken);

router.get('/',       getAll);                            // ambos roles
router.post('/',      requirePermission(Permiso.PaisCrear), create);
router.put('/:id',    requirePermission(Permiso.PaisEditar), update);
router.delete('/:id', requirePermission(Permiso.PaisEliminar), remove);

module.exports = router;
