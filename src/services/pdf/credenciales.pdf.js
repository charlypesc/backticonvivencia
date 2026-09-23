const fs = require('fs');
const path = require('path');
const { jsPDF } = require('jspdf');
const { formatearFecha } = require('../../utils/fecha');

// Comprobante de credenciales (usuario + contraseña temporal) que se entrega
// en mano. Hay dos variantes de la misma hoja: 'creacion' y
// 'restablecimiento'; cambian el distintivo, el saludo y la advertencia,
// porque no es lo mismo recibir una cuenta nueva que enterarse de que a la tuya
// le cambiaron la clave.

// PNG 144x144 del logo. Se lee una vez al cargar el módulo: jsPDF necesita los
// bytes en el momento de dibujar.
const LOGO = new Uint8Array(fs.readFileSync(path.join(__dirname, '../../assets/logo-credenciales.png')));

/**
 * Paleta del documento, en RGB porque jsPDF no entiende hex de tres dígitos.
 * Es la familia del celeste del logo: los azules oscuros son el mismo matiz
 * bajado de luminosidad, porque el celeste puro sobre blanco no llega al
 * contraste mínimo para texto.
 */
const AZUL = [47, 111, 176];
const AZUL_MARCA = [31, 111, 178];
const TINTA = [22, 58, 92];
const GRIS = [92, 107, 122];
const GRIS_ETIQUETA = [107, 130, 153];
const GRIS_PIE = [148, 165, 182];
const BORDE_TARJETA = [223, 234, 245];
const BORDE_TICKET = [207, 226, 243];
const FONDO_TICKET = [246, 250, 253];
const FONDO_NOTA = [234, 243, 251];
const TEXTO_NOTA = [53, 82, 108];
const BORDE_PIE = [238, 243, 248];
const BLANCO = [255, 255, 255];

// Los dos distintivos se separan por color además de por texto: quien reparte
// las hojas tiene que poder distinguirlas de lejos, sin leerlas.
const DISTINTIVO = {
  creacion: {
    texto: 'Cuenta creada',
    fondo: [227, 243, 234],
    tinta: [31, 122, 76],
  },
  restablecimiento: {
    texto: 'Contraseña restablecida',
    fondo: [253, 238, 224],
    tinta: [184, 97, 26],
  },
};

const ANCHO = 595.28; // A4 en puntos
const ALTO = 841.89;
const TARJETA_ANCHO = 460;
const TARJETA_X = (ANCHO - TARJETA_ANCHO) / 2;
const TARJETA_Y = 62;
const PAD = 30; // padding lateral de la tarjeta
const CONTENIDO = TARJETA_ANCHO - PAD * 2;
const LOGO_TAM = 26;

/**
 * Arma el comprobante de credenciales como PDF real (texto seleccionable, no
 * una captura).
 *
 * Se genera en el mismo request que crea o restablece la clave y viaja en esa
 * misma respuesta: la contraseña en claro solo existe ahí, y armar el PDF en
 * otro momento obligaría a que vuelva al servidor para que alguien la imprima.
 *
 * @returns {Buffer}
 */
function construirCredencialesPdf(datos) {
  // `compress` importa desde que hay logo: jsPDF guarda la imagen como bitmap
  // RGB plano y sin esto el archivo pasa de ~5 KB a ~67 KB.
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  const variante = datos.variante ?? 'creacion';
  const esAlta = variante === 'creacion';
  const distintivo = DISTINTIVO[variante];

  const fecha = formatearFecha(new Date());

  // Solo el primer nombre: el saludo con nombre completo suena a carta formal,
  // y esto lo entrega alguien del colegio en mano.
  const nombreCompleto = (datos.nombre || '').trim();
  const pila = nombreCompleto.split(/\s+/)[0] || datos.correo;

  // "Te damos la bienvenida" y no "Bienvenido"/"Bienvenida": el sistema guarda
  // un nombre, no el género de la persona, y adivinarlo por el nombre se
  // equivoca con gente real.
  const titulo = esAlta
    ? `Te damos la bienvenida, ${pila}`
    : 'Tu contraseña fue restablecida';

  const bajada = esAlta
    ? datos.rol
      ? `Tu cuenta como ${minusculaInicial(datos.rol)} ya está lista. Estos son tus datos para ingresar por primera vez.`
      : 'Tu cuenta ya está lista. Estos son tus datos para ingresar por primera vez.'
    : 'Se generó una contraseña nueva para tu cuenta. La anterior dejó de funcionar: usa esta para volver a entrar.';

  const nota = esAlta
    ? {
        titulo: 'Cámbiala apenas ingreses.',
        cuerpo:
          'Esta contraseña la generó el sistema. Entra a "Cambiar contraseña" en el menú ' +
          'superior y reemplázala por una que solo tú conozcas. Destruye este documento después.',
      }
    : {
        titulo: '¿No pediste este cambio?',
        cuerpo:
          'Avisa de inmediato al encargado de convivencia de tu colegio. Si sí lo pediste, ' +
          'cambia esta contraseña apenas ingreses desde "Cambiar contraseña" en el menú superior.',
      };

  // Las filas del ticket. El rol solo en el alta: en un restablecimiento no
  // cambió y ocuparía una línea sin decir nada nuevo.
  const filas = [
    { etiqueta: 'Usuario', valor: datos.correo, destacado: false },
  ];
  if (esAlta && datos.rol) filas.push({ etiqueta: 'Rol', valor: datos.rol, destacado: false });
  filas.push({ etiqueta: 'Contraseña temporal', valor: datos.password, destacado: true });

  // ---- Medición ----
  // La tarjeta se dibuja antes que su contenido (si no, lo taparía), así que
  // primero hay que saber cuánto va a medir todo lo que va adentro.
  doc.setFont('times', 'bold');
  doc.setFontSize(24);
  const lineasTitulo = doc.splitTextToSize(titulo, CONTENIDO) ;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const lineasBajada = doc.splitTextToSize(bajada, CONTENIDO - 20) ;

  doc.setFontSize(10);
  const lineasNota = doc.splitTextToSize(nota.cuerpo, CONTENIDO - 34) ;

  const FILA_ALTO = 30;
  const ticketAlto = 16 + filas.length * FILA_ALTO + 4;
  // 14 de aire arriba, el titular en su propia línea, el cuerpo, y 14 abajo.
  const notaAlto = 14 + 16 + lineasNota.length * 15 + 14;

  const cabeceraAlto =
    PAD + LOGO_TAM + 22 + 20 + 14 + 14 + 10 + lineasTitulo.length * 29 + 10 + lineasBajada.length * 16;
  const cuerpoAlto = 18 + ticketAlto + 18 + notaAlto + 26;
  const pieAlto = 40;
  const tarjetaAlto = cabeceraAlto + cuerpoAlto + pieAlto;

  // ---- Tarjeta ----
  doc.setFillColor(...BLANCO);
  doc.setDrawColor(...BORDE_TARJETA);
  doc.setLineWidth(1);
  doc.roundedRect(TARJETA_X, TARJETA_Y, TARJETA_ANCHO, tarjetaAlto, 18, 18, 'FD');

  let y = TARJETA_Y + PAD;
  const x = TARJETA_X + PAD;

  // ---- Marca ----
  doc.addImage(LOGO, 'PNG', x, y, LOGO_TAM, LOGO_TAM);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...AZUL_MARCA);
  doc.text('MiConvivencia', x + LOGO_TAM + 9, y + LOGO_TAM / 2 + 4);

  y += LOGO_TAM + 22;

  // ---- Distintivo ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const anchoDistintivo = doc.getTextWidth(distintivo.texto) + 20;
  doc.setFillColor(...distintivo.fondo);
  doc.roundedRect(x, y, anchoDistintivo, 20, 10, 10, 'F');
  doc.setTextColor(...distintivo.tinta);
  doc.text(distintivo.texto, x + 10, y + 13.5);

  y += 20 + 14;

  // ---- Colegio y fecha ----
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...GRIS);
  const colegio = datos.establecimiento || 'Sistema de convivencia escolar';
  doc.text(colegio, x, y + 8);

  // El separador se dibuja como un punto y no como carácter: el «·» no está en
  // la codificación de las fuentes base de jsPDF y salía como un hueco.
  const anchoColegio = doc.getTextWidth(colegio);
  doc.setFillColor(...GRIS_PIE);
  doc.circle(x + anchoColegio + 8, y + 4.5, 1.4, 'F');

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GRIS_ETIQUETA);
  doc.text(fecha, x + anchoColegio + 16, y + 8);

  y += 14 + 10;

  // ---- Título ----
  // Serif para el saludo y palo seco para todo lo demás: es la única línea que
  // se dirige a la persona, y el contraste tipográfico la separa del formulario.
  doc.setFont('times', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(...TINTA);
  lineasTitulo.forEach((linea, i) => doc.text(linea, x, y + 20 + i * 29));
  y += lineasTitulo.length * 29 + 10;

  // ---- Bajada ----
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...GRIS);
  lineasBajada.forEach((linea, i) => doc.text(linea, x, y + 10 + i * 16));
  y += lineasBajada.length * 16 + 18;

  // ---- Ticket ----
  doc.setFillColor(...FONDO_TICKET);
  doc.setDrawColor(...BORDE_TICKET);
  doc.setLineWidth(1.5);
  doc.roundedRect(x, y, CONTENIDO, ticketAlto, 14, 14, 'FD');

  // Las muescas laterales lo vuelven un pase recortable y no una tabla más.
  // Van del color de la tarjeta, no del ticket: simulan un hueco.
  const centroTicket = y + ticketAlto / 2;
  doc.setFillColor(...BLANCO);
  doc.circle(x, centroTicket, 8, 'FD');
  doc.circle(x + CONTENIDO, centroTicket, 8, 'FD');

  filas.forEach(({ etiqueta, valor, destacado }, i) => {
    const baseY = y + 16 + i * FILA_ALTO + 18;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRIS_ETIQUETA);
    doc.text(etiqueta.toUpperCase(), x + 18, baseY);

    // Courier: el correo y la clave se transcriben a mano y hay que poder
    // distinguir l de 1 y O de 0 sin adivinar.
    doc.setFont('courier', 'bold');
    doc.setFontSize(destacado ? 12 : 10.5);
    doc.setTextColor(...(destacado ? AZUL : TINTA));

    const derecha = x + CONTENIDO - 18;
    if (destacado) {
      // La contraseña va en su propia pastilla: es el único dato que la persona
      // tiene que encontrar de un vistazo mientras teclea.
      const anchoValor = doc.getTextWidth(valor) + 20;
      doc.setFillColor(...FONDO_NOTA);
      doc.roundedRect(derecha - anchoValor, baseY - 12, anchoValor, 19, 6, 6, 'F');
      doc.text(valor, derecha - 10, baseY, { align: 'right' });
    } else {
      // Un correo largo no puede pisar su etiqueta ni salirse del ticket.
      const disponible = CONTENIDO - 36 - doc.getTextWidth(etiqueta.toUpperCase()) - 16;
      doc.text(acortar(doc, valor, disponible), derecha, baseY, { align: 'right' });
    }
  });

  y += ticketAlto + 18;

  // ---- Nota ----
  doc.setFillColor(...FONDO_NOTA);
  doc.rect(x, y, CONTENIDO, notaAlto, 'F');
  doc.setFillColor(...AZUL);
  doc.rect(x, y, 3, notaAlto, 'F');

  // El titular va en su propia línea y no como arranque en negrita del párrafo:
  // jsPDF mide el salto de línea con una sola fuente, así que mezclar negrita y
  // normal en el mismo renglón deja el corte descalzado.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...TINTA);
  doc.text(nota.titulo, x + 17, y + 14 + 10);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXTO_NOTA);
  lineasNota.forEach((linea, i) => doc.text(linea, x + 17, y + 14 + 26 + i * 15));

  y += notaAlto + 26;

  // ---- Pie ----
  doc.setDrawColor(...BORDE_PIE);
  doc.setLineWidth(1);
  doc.line(TARJETA_X, y, TARJETA_X + TARJETA_ANCHO, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS_PIE);
  doc.text(
    'Documento generado automáticamente. No lo compartas por correo ni mensajería.',
    x,
    y + 18,
  );

  return Buffer.from(doc.output('arraybuffer'));
}

/** "Encargado de convivencia" → "encargado de convivencia", para meterlo en una frase. */
function minusculaInicial(texto) {
  return texto.charAt(0).toLocaleLowerCase('es') + texto.slice(1);
}

/**
 * Recorta con puntos suspensivos hasta que el texto entre en `ancho`, midiendo
 * con la fuente que el documento tenga puesta en ese momento (por eso recibe el
 * `doc` y no se calcula con un largo fijo de caracteres).
 */
function acortar(doc, texto, ancho) {
  if (doc.getTextWidth(texto) <= ancho) return texto;
  let corte = texto.length;
  while (corte > 1 && doc.getTextWidth(texto.slice(0, corte) + '…') > ancho) corte--;
  return texto.slice(0, corte) + '…';
}

/** Nombre de archivo estable y sin caracteres que rompan en Windows. */
const nombreArchivoCredenciales = (correo) => `credenciales-${String(correo).replace(/[^a-z0-9]+/gi, '-')}.pdf`;

/**
 * Lo que va en la respuesta del alta/restablecimiento: el PDF en base64 y su
 * nombre. Si el PDF falla, la clave igual se entrega (sin documento): perder
 * la respuesta entera dejaría la cuenta creada con una clave que nadie vio.
 */
const credencialesPdfParaRespuesta = (datos) => {
  try {
    return {
      pdf_base64: construirCredencialesPdf(datos).toString('base64'),
      pdf_nombre: nombreArchivoCredenciales(datos.correo),
    };
  } catch (err) {
    console.error('No se pudo armar el PDF de credenciales', err);
    return { pdf_base64: null, pdf_nombre: null };
  }
};

module.exports = { construirCredencialesPdf, credencialesPdfParaRespuesta };
