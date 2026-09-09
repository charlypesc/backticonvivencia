const router = require('express').Router();
const { actualizar, finalizar, registrarSeguimiento } = require('../controllers/medidasProteccion.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

// Ver y crear medidas cuelga del caso (/api/protocolos-activados/:id/...): una
// medida sin caso no existe. Acá van las acciones sobre una medida concreta,
// que ya no necesitan saber de qué caso viene.
router.use(verifyToken, resolverScope, requireEstablecimiento);

// Corregir va con el permiso de crear y no con uno propio: quien puede decretar
// la medida es quien puede arreglar el error con que la cargó. Un permiso nuevo
// solo para esto habría que repartirlo a los mismos roles.
router.put  ('/:id',             requirePermission(Permiso.MedidaProteccionCrear), actualizar);
router.patch('/:id/finalizar',   requirePermission(Permiso.MedidaProteccionFinalizar), finalizar);
router.post ('/:id/seguimiento', requirePermission(Permiso.MedidaProteccionRegistrarSeguimiento), registrarSeguimiento);

module.exports = router;
