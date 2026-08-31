const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

// Compresión de lo que la gente adjunta.
//
// El criterio es que nadie tenga que preocuparse por el peso: se acepta la foto
// de 12 MB que salió del teléfono y es el sistema el que la baja, no la persona
// la que tiene que buscar cómo achicarla. Un límite de entrada estricto sería
// empujar a no adjuntar nada, y en constancias y expedientes lo que no se
// adjunta simplemente no existe después.
//
// Regla de oro: comprimir NUNCA puede empeorar las cosas. Si el resultado pesa
// más que el original, o si el proceso falla, se devuelve el original tal cual.
// Un adjunto sin comprimir es un problema de espacio; un adjunto corrupto o
// perdido es un problema legal.

// 2200 px de lado mayor: suficiente para leer a simple vista un documento
// firmado escaneado o fotografiado, y muy por debajo de los 4000+ px que
// produce cualquier teléfono actual.
const LADO_MAXIMO = 2200;
const CALIDAD_JPEG = 72;

const esImagen = (mimetype) => typeof mimetype === 'string' && mimetype.startsWith('image/');
const esPdf = (mimetype) => mimetype === 'application/pdf';

const cambiarExtension = (nombre, ext) =>
  `${String(nombre ?? 'archivo').replace(/\.[^.]+$/, '')}.${ext}`;

/**
 * Imagen → JPEG redimensionado.
 *
 * `rotate()` sin argumentos aplica la orientación EXIF antes de redimensionar:
 * sin esto, una foto tomada en vertical con el teléfono se guarda acostada,
 * porque al recomprimir se pierde el metadato que la enderezaba.
 *
 * `withoutEnlargement` evita agrandar una imagen que ya era chica, que
 * aumentaría el peso sin agregar información.
 */
const comprimirImagen = async (buffer) => {
  const salida = await sharp(buffer)
    .rotate()
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: CALIDAD_JPEG, mozjpeg: true })
    .toBuffer();
  return { buffer: salida, mimetype: 'image/jpeg', extension: 'jpg' };
};

/**
 * PDF → PDF regrabado con object streams.
 *
 * Esto NO recomprime las imágenes que el PDF lleva dentro: para eso haría falta
 * Ghostscript, que es un binario externo y no una dependencia de npm. Lo que sí
 * hace es compactar la estructura del archivo, que en los PDF generados por
 * escáneres y apps de celular suele traer bastante desperdicio. Cuando no hay
 * nada que ganar, el resultado pesa igual o más y se descarta solo por la regla
 * de oro de arriba.
 */
const comprimirPdf = async (buffer) => {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const salida = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
  return { buffer: Buffer.from(salida), mimetype: 'application/pdf', extension: 'pdf' };
};

/**
 * Comprime lo que se pueda y devuelve siempre algo usable.
 *
 * @param {{buffer: Buffer, mimetype: string, originalname: string}} archivo el `req.file` de multer
 * @returns {Promise<{buffer: Buffer, mimetype: string, originalname: string, size: number,
 *                    bytes_originales: number, comprimido: boolean}>}
 */
const comprimirArchivo = async (archivo) => {
  const original = {
    buffer: archivo.buffer,
    mimetype: archivo.mimetype,
    originalname: archivo.originalname,
    size: archivo.buffer.length,
    bytes_originales: archivo.buffer.length,
    comprimido: false,
  };

  try {
    let r = null;
    if (esImagen(archivo.mimetype)) r = await comprimirImagen(archivo.buffer);
    else if (esPdf(archivo.mimetype)) r = await comprimirPdf(archivo.buffer);
    if (!r) return original;

    // Si comprimir no ganó nada, se devuelve el original: recomprimir una
    // imagen ya optimizada solo le saca calidad.
    if (r.buffer.length >= original.size) return original;

    return {
      buffer: r.buffer,
      mimetype: r.mimetype,
      originalname: cambiarExtension(archivo.originalname, r.extension),
      size: r.buffer.length,
      bytes_originales: original.size,
      comprimido: true,
    };
  } catch (err) {
    // Un PDF cifrado, un formato que libvips no reconoce, una imagen rota: el
    // adjunto se guarda igual. Se loguea para poder revisarlo, pero jamás se
    // pierde el archivo por no haber podido comprimirlo.
    console.warn('No se pudo comprimir el adjunto, se guarda el original:', err.message);
    return original;
  }
};

module.exports = { comprimirArchivo, LADO_MAXIMO, CALIDAD_JPEG };
