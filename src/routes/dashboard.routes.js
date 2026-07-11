const router = require('express').Router();
const { getResumen } = require('../controllers/dashboard.controller');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);
router.get('/', getResumen);

module.exports = router;