// const { GoogleGenerativeAI } = require('@google/generative-ai');

// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// // const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
// const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// async function estructurarTextoOCR(textoOCR) {
//   const prompt = `
// Dado el siguiente texto extraído por OCR de un manuscrito de registro de convivencia escolar:

// "${textoOCR}"

// Extrae y estructura la información en este JSON exacto:
// {
//   "fecha_incidente": "YYYY-MM-DD o null",
//   "tematica": "texto descriptivo o null",
//   "antecedentes": "texto descriptivo o null",
//   "acuerdos": "texto descriptivo o null",
//   "tipo_falta": "texto o null",
//   "estudiantes": [
//     { "nombre": "nombre completo corregido", "rut": "RUT formateado o null" }
//   ]
// }

// Reglas:
// - Corrige errores ortográficos obvios del OCR (Fechz → Fecha, Temzzicz → Temática, etc.)
// - Interpreta fechas aunque estén mal escritas (110-07-26 → 2026-07-10)
// - Responde SOLO con el JSON, sin texto adicional, sin markdown, sin backticks
// `;

//   const result = await model.generateContent(prompt);
//   const texto = result.response.text().trim();
  
//   return JSON.parse(texto);
// }

// module.exports = { estructurarTextoOCR };

const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function estructurarTextoOCR(textoOCR, tiposFalta = [], estudiantes = []) {
  const catalogoTiposFalta = tiposFalta
    .map(tf => `- id_tipo_falta=${tf.id_tipo_falta}: ${tf.nombre}`)
    .join('\n');

  const catalogoEstudiantes = estudiantes
    .map(e => `- id_estudiante=${e.id_estudiante}: ${e.nombre} ${e.apellido}`)
    .join('\n');

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Eres un asistente que extrae y estructura información de textos OCR de documentos manuscritos de convivencia escolar. Respondes SOLO con JSON válido, sin markdown, sin backticks, sin explicaciones.',
      },
      {
        role: 'user',
        content: `Dado el siguiente texto extraído por OCR de un manuscrito:

"${textoOCR}"

Catálogo de tipos de falta disponibles (usa el id_tipo_falta que mejor corresponda, o null si ninguno aplica):
${catalogoTiposFalta || '(sin catálogo disponible)'}

Catálogo de estudiantes del establecimiento (usa id_estudiante de la coincidencia más probable por nombre, o null si no hay coincidencia clara):
${catalogoEstudiantes || '(sin catálogo disponible)'}

Extrae y estructura la información en este JSON exacto:
{
  "fecha_incidente": "YYYY-MM-DD o null",
  "tematica": "texto descriptivo o null",
  "antecedentes": "texto descriptivo o null",
  "acuerdos": "texto descriptivo o null",
  "id_tipo_falta": "id_tipo_falta del catálogo o null",
  "estudiantes": [
    { "id_estudiante": "id_estudiante del catálogo o null", "rol_en_incidente": "texto o null" }
  ]
}

Corrige errores ortográficos obvios del OCR e interpreta fechas aunque estén mal escritas.`,
      },
    ],
    temperature: 0.1,
  });

  const texto = response.choices[0].message.content.trim();
  return JSON.parse(texto);
}

module.exports = { estructurarTextoOCR };