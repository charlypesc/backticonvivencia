const router = require('express').Router();
const { exportarMasivo } = require('../controllers/expediente.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);

// El expediente de UN caso vive en /api/protocolos-activados/:id/expediente.
// Acá va solo la exportación masiva, que es una obligación distinta (arts. 37
// del Estatuto Docente y 29 bis de la Ley 21.109) y por eso tiene su propio
// permiso: entregarle 24 meses de casos a un tercero no es lo mismo que abrir
// el expediente de un caso propio.
router.get('/masivo', requirePermission(Permiso.ExpedienteExportarMasivo), exportarMasivo);

module.exports = router;
