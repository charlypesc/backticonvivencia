const router = require('express').Router();
const { registrarResultado } = require('../controllers/medidasDisciplinarias.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);

// El resultado se registra después de aplicada la medida, por eso va aparte del
// alta. Es el dato que el informe de expulsión exige y el que nunca se completa
// si no se pide explícitamente.
router.patch('/:id/resultado', requirePermission(Permiso.MedidaDisciplinariaRegistrar), registrarResultado);

module.exports = router;
