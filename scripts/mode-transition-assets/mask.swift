// Usage: swift mask.swift INPUT.png OUTPUT-mask.png
//
// INPUT can be a laolao-mode-transition-<mode>.png or laolao-splash.png.
// Writes an 8-bit grayscale foreground mask (white = subject) at the input size.
import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3, let image = CIImage(contentsOf: URL(fileURLWithPath: args[1])) else {
    FileHandle.standardError.write("usage: mask.swift INPUT.png OUTPUT-mask.png\n".data(using: .utf8)!)
    exit(2)
}

let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: image)
try handler.perform([request])
guard let result = request.results?.first else {
    FileHandle.standardError.write("no foreground found\n".data(using: .utf8)!)
    exit(1)
}
print("instances:", result.allInstances.count)
let buffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
let mask = CIImage(cvPixelBuffer: buffer)

let context = CIContext()
let gray = CGColorSpaceCreateDeviceGray()
guard let cg = context.createCGImage(mask, from: mask.extent, format: .L8, colorSpace: gray) else { exit(1) }
let rep = NSBitmapImageRep(cgImage: cg)
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("mask:", Int(mask.extent.width), "x", Int(mask.extent.height))
