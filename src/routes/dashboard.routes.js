const router = require('express').Router();
const { getResumen } = require('../controllers/dashboard.controller');
const { verifyToken, requirePermission } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');
const { Permiso } = require('../constants/permisos');

router.use(verifyToken, resolverScope, requireEstablecimiento);
router.get('/', requirePermission(Permiso.DashboardVer), getResumen);

module.exports = router;