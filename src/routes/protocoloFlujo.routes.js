// mergeParams porque este router se monta debajo de /:id_protocolo: sin eso el
// controller no vería de qué protocolo cuelga el paso que está editando.
const router = require('express').Router({ mergeParams: true });
const {
  getGrafo,
  crearPaso, actualizarPaso, eliminarPaso, guardarPasoCompletoGenerico,
  crearTransicion, actualizarTransicion, eliminarTransicion,
  reemplazarRoles,
  crearCampo, actualizarCampo, eliminarCampo,
  validar, publicar,
} = require('../controllers/protocoloFlujo.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { Permiso } = require('../constants/permisos');

// El catálogo genérico es global, igual que en protocolosGenericos.routes.js:
// no corren resolverScope/requireEstablecimiento. Un ADMIN diseña el grafo sin
// haber elegido un colegio.
router.use(verifyToken);

// Ver el grafo lo puede hacer cualquiera que vaya a ejecutarlo; editarlo, solo
// el ADMIN. Por eso el permiso de lectura va aparte del de escritura.
router.get('/', requirePermission(Permiso.ProtocoloFlujoVer), getGrafo);

// El paso entero de una vez: datos, responsables, preguntas y salidas en una
// transacción. Es por donde guarda el formulario del editor; los endpoints de
// a uno de abajo quedan para las ediciones sueltas desde el diagrama.
router.post('/pasos/completo',          requirePermission(Permiso.ProtocoloFlujoEditar), guardarPasoCompletoGenerico);
router.put ('/pasos/:id_paso/completo', requirePermission(Permiso.ProtocoloFlujoEditar), guardarPasoCompletoGenerico);

router.post  ('/pasos',          requirePermission(Permiso.ProtocoloFlujoEditar), crearPaso);
router.put   ('/pasos/:id_paso', requirePermission(Permiso.ProtocoloFlujoEditar), actualizarPaso);
router.delete('/pasos/:id_paso', requirePermission(Permiso.ProtocoloFlujoEditar), eliminarPaso);

router.post  ('/transiciones',                 requirePermission(Permiso.ProtocoloFlujoEditar), crearTransicion);
router.put   ('/transiciones/:id_transicion',  requirePermission(Permiso.ProtocoloFlujoEditar), actualizarTransicion);
router.delete('/transiciones/:id_transicion',  requirePermission(Permiso.ProtocoloFlujoEditar), eliminarTransicion);

// Reemplaza el set completo de roles del paso, no agrega de a uno.
router.put('/pasos/:id_paso/roles', requirePermission(Permiso.ProtocoloFlujoEditar), reemplazarRoles);

router.post  ('/pasos/:id_paso/campos',           requirePermission(Permiso.ProtocoloFlujoEditar), crearCampo);
router.put   ('/pasos/:id_paso/campos/:id_campo', requirePermission(Permiso.ProtocoloFlujoEditar), actualizarCampo);
router.delete('/pasos/:id_paso/campos/:id_campo', requirePermission(Permiso.ProtocoloFlujoEditar), eliminarCampo);

// Validar es de solo lectura y sirve para mostrar los problemas mientras se
// arma el grafo; publicar corre lo mismo y recién ahí escribe el estado.
router.get ('/validar',  requirePermission(Permiso.ProtocoloFlujoVer),      validar);
router.post('/publicar', requirePermission(Permiso.ProtocoloFlujoPublicar), publicar);

module.exports = router;
