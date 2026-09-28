const router = require('express').Router();
const {
  getAll, getById, create, update, remove, confirmar,
  atender, derivar, marcarDerivacionAtendida, getPdf,
} = require('../controllers/registros.controller');
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
router.delete('/:id',     requirePermission(Permiso.RegistroEliminar), bloquearEscrituraConfidencial, remove);
router.patch('/:id/confirmar', requirePermission(Permiso.RegistroConfirmar), bloquearEscrituraConfidencial, confirmar);

// El registro tal como se llenó, en PDF (sin protocolo: eso es el expediente).
router.get('/:id/pdf', requirePermission(Permiso.RegistroVer), getPdf);

// Atención y derivación. Tomar y derivar es del coordinador; marcar atendida
// una derivación no lleva permiso porque solo puede hacerlo su destinatario, y
// eso lo comprueba el controller contra req.user.id.
router.post('/:id/atender', requirePermission(Permiso.RegistroDerivar), atender);
router.post('/:id/derivar', requirePermission(Permiso.RegistroDerivar), derivar);
router.post('/:id/derivacion/atendida', marcarDerivacionAtendida);

// Medidas disciplinarias del caso, con su resultado. Cuelgan del registro
// porque es el hecho el que las motiva, y son el insumo obligatorio del informe
// previo de expulsión (art. 2 N° 5 de la Ley 21.809).
router.get ('/:id/medidas-disciplinarias', requirePermission(Permiso.MedidaDisciplinariaVer),       medidasDisciplinarias.getByRegistro);
router.post('/:id/medidas-disciplinarias', requirePermission(Permiso.MedidaDisciplinariaRegistrar), medidasDisciplinarias.crear);

module.exports = router;