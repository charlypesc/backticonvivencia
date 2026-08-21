const router = require('express').Router();
const { getAll, create, update, remove } = require('../controllers/provincias.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken);

router.get('/',       getAll);                            // ambos roles
router.post('/',      requirePermission(Permiso.ProvinciaCrear), create);
router.put('/:id',    requirePermission(Permiso.ProvinciaEditar), update);
router.delete('/:id', requirePermission(Permiso.ProvinciaEliminar), remove);

module.exports = router;
