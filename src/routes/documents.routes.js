const express = require('express');
const router = express.Router();
const multer = require('multer');
const { verifyToken } = require('../middleware/auth');
const { subirDocumento, obtenerPorRegistro } = require('../controllers/documentos.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Tipo de archivo no permitido'));
  },
});

router.post('/', verifyToken, upload.single('archivo'), subirDocumento);
router.get('/registro/:id_registro', verifyToken, obtenerPorRegistro);

module.exports = router;