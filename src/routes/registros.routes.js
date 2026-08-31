const router = require('express').Router();
const { getAll, getById, create, validar, update, remove, confirmar } = require('../controllers/registros.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { bloquearEscrituraConfidencial } = require('../middleware/confidencial');
const { Permiso } = require('../constants/permisos');
const medidasDisciplinarias = require('../controllers/medidasDisciplinarias.controller');

router.use(verifyToken, resolverScope, requireEstablecimiento);

router.get('/',           getAll);
router.get('/:id',        getById);
router.post('/',          requirePermission(Permiso.RegistroCrear),    create);
router.put('/:id',        requirePermission(Permiso.RegistroEditar),   bloquearEscrituraConfidencial, update);
router.patch('/:id/validar', requirePermission(Permiso.RegistroValidar),  bloquearEscrituraConfidencial, validar);
router.delete('/:id',     requirePermission(Permiso.RegistroEliminar), bloquearEscrituraConfidencial, remove);
router.patch('/:id/confirmar', requirePermission(Permiso.RegistroConfirmar), bloquearEscrituraConfidencial, confirmar);

// Medidas disciplinarias del caso, con su resultado. Cuelgan del registro
// porque es el hecho el que las motiva, y son el insumo obligatorio del informe
// previo de expulsión (art. 2 N° 5 de la Ley 21.809).
router.get ('/:id/medidas-disciplinarias', requirePermission(Permiso.MedidaDisciplinariaVer),       medidasDisciplinarias.getByRegistro);
router.post('/:id/medidas-disciplinarias', requirePermission(Permiso.MedidaDisciplinariaRegistrar), medidasDisciplinarias.crear);

module.exports = router;