const router = require('express').Router();
const {
  actualizar, reemplazarComision, firmar, emitir, decidir, registrarEnvios,
} = require('../controllers/informeExpulsion.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);

router.put ('/:id',          requirePermission(Permiso.InformeExpulsionElaborar), actualizar);
router.put ('/:id/comision', requirePermission(Permiso.InformeExpulsionElaborar), reemplazarComision);
router.post('/:id/firmar',   requirePermission(Permiso.InformeExpulsionElaborar), firmar);
router.post('/:id/emitir',   requirePermission(Permiso.InformeExpulsionElaborar), emitir);

// Resolver la medida es del director, no de la comisión: permiso distinto.
router.post ('/:id/decidir',           requirePermission(Permiso.InformeExpulsionDecidir), decidir);
router.patch('/:id/informes-enviados', requirePermission(Permiso.InformeExpulsionDecidir), registrarEnvios);

module.exports = router;
