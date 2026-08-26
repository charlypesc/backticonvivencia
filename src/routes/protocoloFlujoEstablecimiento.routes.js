// mergeParams: este router se monta debajo de /:id_protocolo_establecimiento.
const router = require('express').Router({ mergeParams: true });
const {
  getGrafo,
  personalizar, restaurar,
  crearPaso, actualizarPaso, eliminarPaso,
  crearTransicion, actualizarTransicion, eliminarTransicion,
  reemplazarRoles,
  crearCampo, actualizarCampo, eliminarCampo,
  validar,
} = require('../controllers/protocoloFlujoEstablecimiento.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

// A diferencia del catálogo global, esto sí es data de un colegio: el scope se
// resuelve y se exige, y cada consulta del controller filtra por él.
router.use(verifyToken, resolverScope, requireEstablecimiento);

router.get('/', requirePermission(Permiso.ProtocoloFlujoEstablecimientoVer), getGrafo);

// Clonar el grafo del catálogo / descartar la copia y volver a heredar.
router.post  ('/personalizar', requirePermission(Permiso.ProtocoloFlujoEstablecimientoPersonalizar), personalizar);
router.delete('/personalizar', requirePermission(Permiso.ProtocoloFlujoEstablecimientoRestaurar),    restaurar);

const editar = requirePermission(Permiso.ProtocoloFlujoEstablecimientoEditar);

router.post  ('/pasos',          editar, crearPaso);
router.put   ('/pasos/:id_paso', editar, actualizarPaso);
router.delete('/pasos/:id_paso', editar, eliminarPaso);

router.post  ('/transiciones',                editar, crearTransicion);
router.put   ('/transiciones/:id_transicion', editar, actualizarTransicion);
router.delete('/transiciones/:id_transicion', editar, eliminarTransicion);

router.put('/pasos/:id_paso/roles', editar, reemplazarRoles);

router.post  ('/pasos/:id_paso/campos',           editar, crearCampo);
router.put   ('/pasos/:id_paso/campos/:id_campo', editar, actualizarCampo);
router.delete('/pasos/:id_paso/campos/:id_campo', editar, eliminarCampo);

router.get('/validar', requirePermission(Permiso.ProtocoloFlujoEstablecimientoVer), validar);

module.exports = router;
