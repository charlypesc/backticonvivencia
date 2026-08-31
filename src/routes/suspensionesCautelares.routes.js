const router = require('express').Router();
const {
  registrarReconsideracion, resolver,
} = require('../controllers/suspensionCautelar.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

// Igual que medidasProteccion: ver y crear cuelgan del caso
// (/api/protocolos-activados/:id/...), porque una cautelar sin procedimiento
// sancionatorio no existe. Acá van las acciones sobre una suspensión concreta,
// que ya no necesitan saber de qué caso viene.
router.use(verifyToken, resolverScope, requireEstablecimiento);

router.patch('/:id/reconsideracion',
  requirePermission(Permiso.SuspensionCautelarRegistrarReconsideracion), registrarReconsideracion);

// Resolver es facultad del director: es el mismo que decretó la medida y el
// que la ley obliga a resolver previa consulta al Consejo de Profesores.
router.patch('/:id/resolver',
  requirePermission(Permiso.SuspensionCautelarResolver), resolver);

module.exports = router;
