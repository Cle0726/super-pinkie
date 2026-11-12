// Usage: swift masks.swift INPUT.png OUTDIR — writes OUTDIR/inst-<n>.png (one grayscale mask per Vision foreground instance).
import AppKit
import CoreImage
import Vision
let a = CommandLine.arguments
guard a.count == 3, let image = CIImage(contentsOf: URL(fileURLWithPath: a[1])) else { exit(2) }
let req = VNGenerateForegroundInstanceMaskRequest()
let h = VNImageRequestHandler(ciImage: image)
try h.perform([req])
guard let r = req.results?.first else { print("none"); exit(1) }
let ctx = CIContext(); let gray = CGColorSpaceCreateDeviceGray()
try FileManager.default.createDirectory(atPath: a[2], withIntermediateDirectories: true)
for i in r.allInstances {
  let buf = try r.generateScaledMaskForImage(forInstances: IndexSet(integer: i), from: h)
  let m = CIImage(cvPixelBuffer: buf)
  guard let cg = ctx.createCGImage(m, from: m.extent, format: .L8, colorSpace: gray) else { continue }
  try NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(a[2])/inst-\(i).png"))
  print("inst", i)
}
