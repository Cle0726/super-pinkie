import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("usage: clean-checkerboard input.png output.png\n", stderr)
    exit(2)
}

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let source = NSImage(contentsOf: input),
      let cgImage = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fputs("cannot read input\n", stderr)
    exit(1)
}

let width = cgImage.width
let height = cgImage.height
let count = width * height
var pixels = [UInt8](repeating: 0, count: count * 4)
let space = CGColorSpaceCreateDeviceRGB()
guard let context = CGContext(data: &pixels, width: width, height: height,
                              bitsPerComponent: 8, bytesPerRow: width * 4,
                              space: space,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue |
                                  CGBitmapInfo.byteOrder32Big.rawValue) else {
    fputs("cannot create bitmap\n", stderr)
    exit(1)
}
context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

func looksLikeChecker(_ index: Int) -> Bool {
    let offset = index * 4
    let red = Int(pixels[offset])
    let green = Int(pixels[offset + 1])
    let blue = Int(pixels[offset + 2])
    let alpha = Int(pixels[offset + 3])
    if alpha < 10 { return true }
    let low = min(red, green, blue)
    let high = max(red, green, blue)
    return low >= 222 && high - low <= 13
}

var outside = [UInt8](repeating: 0, count: count)
var queue = [Int]()
queue.reserveCapacity(count / 2)
func enqueue(_ index: Int) {
    guard outside[index] == 0, looksLikeChecker(index) else { return }
    outside[index] = 1
    queue.append(index)
}
for x in 0..<width {
    enqueue(x)
    enqueue((height - 1) * width + x)
}
for y in 0..<height {
    enqueue(y * width)
    enqueue(y * width + width - 1)
}
var cursor = 0
while cursor < queue.count {
    let index = queue[cursor]
    cursor += 1
    let x = index % width
    let y = index / width
    if x > 0 { enqueue(index - 1) }
    if x + 1 < width { enqueue(index + 1) }
    if y > 0 { enqueue(index - width) }
    if y + 1 < height { enqueue(index + width) }
}
for index in 0..<count where outside[index] == 1 {
    pixels[index * 4 + 3] = 0
}

guard let cleaned = context.makeImage() else {
    fputs("cannot create output image\n", stderr)
    exit(1)
}
let representation = NSBitmapImageRep(cgImage: cleaned)
guard let data = representation.representation(using: .png, properties: [:]) else {
    fputs("cannot encode png\n", stderr)
    exit(1)
}
try data.write(to: output, options: .atomic)
