// OCR con el framework Vision de macOS. Sin dependencias externas.
//
// Existe porque la Circular 482 que publica la propia Superintendencia es un
// escaneo sin capa de texto: 48 bytes de texto en 48 páginas. Es el documento
// que define el contenido mínimo de cada protocolo, o sea el que más falta
// poder buscar, y el único del corpus que no se puede grepear.
//
// Uso: swift ocr.swift <dir-con-pngs> <salida.txt>

import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("uso: swift ocr.swift <dir-pngs> <salida.txt>\n".data(using: .utf8)!)
    exit(1)
}
let dir = args[1], salida = args[2]

let pngs = (try! FileManager.default.contentsOfDirectory(atPath: dir))
    .filter { $0.hasSuffix(".png") }
    .sorted()

var todo = ""
for (i, nombre) in pngs.enumerated() {
    let ruta = (dir as NSString).appendingPathComponent(nombre)
    guard let img = NSImage(contentsOfFile: ruta),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write("no se pudo leer \(nombre)\n".data(using: .utf8)!)
        continue
    }

    let req = VNRecognizeTextRequest()
    // accurate y no fast: el documento se va a citar en decisiones de diseño,
    // un OCR sucio es peor que no tenerlo porque da falsa confianza.
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["es-ES"]
    req.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch {
        FileHandle.standardError.write("falló OCR en \(nombre): \(error)\n".data(using: .utf8)!)
        continue
    }

    let lineas = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    // El número de página va en el texto: sin él, una cita "p. 34" no se puede
    // volver a encontrar en el PDF original.
    todo += "\n\n========== PÁGINA \(i + 1) ==========\n" + lineas.joined(separator: "\n")

    FileHandle.standardError.write("pág \(i + 1)/\(pngs.count) — \(lineas.count) líneas\n".data(using: .utf8)!)
}

try! todo.write(toFile: salida, atomically: true, encoding: .utf8)
print("OK: \(todo.count) caracteres en \(salida)")
