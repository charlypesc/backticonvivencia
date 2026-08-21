const router = require('express').Router();
const { getResumen } = require('../controllers/dashboard.controller');
const { verifyToken } = require('../middleware/auth');
const { resolverScope, requireEstablecimiento } = require('../middleware/scope');

router.use(verifyToken, resolverScope, requireEstablecimiento);
router.get('/', getResumen);

module.exports = router;