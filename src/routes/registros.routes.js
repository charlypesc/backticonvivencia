const router = require('express').Router();
const { getAll, getById, create, validar, update, remove, confirmar } = require('../controllers/registros.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { bloquearEscrituraConfidencial } = require('../middleware/confidencial');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);

router.get('/',           getAll);
router.get('/:id',        getById);
router.post('/',          requirePermission(Permiso.RegistroCrear),    create);
router.put('/:id',        requirePermission(Permiso.RegistroEditar),   bloquearEscrituraConfidencial, update);
router.patch('/:id/validar', requirePermission(Permiso.RegistroValidar),  bloquearEscrituraConfidencial, validar);
router.delete('/:id',     requirePermission(Permiso.RegistroEliminar), bloquearEscrituraConfidencial, remove);
router.patch('/:id/confirmar', requirePermission(Permiso.RegistroConfirmar), bloquearEscrituraConfidencial, confirmar);

module.exports = router;