// macOS 启动器无边框窗口、拖拽区、内置浏览器面板自定义视图、几何约束与动效开关。
import AppKit
import AVFoundation
import CommonCrypto
import Darwin
import Foundation
import Speech
import UserNotifications
import WebKit

final class LauncherWindow: NSWindow {
    // Borderless NSWindow instances are not key windows by default. The
    // dashboard contains text inputs, so it must be able to receive focus.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    // A borderless window can otherwise be dragged completely off-screen;
    // AppKit then keeps rendering a valid 1280px page while the user only sees
    // its right-hand slice. Always keep a small usable portion on the target
    // display, including after a resize or monitor change.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        var rect = super.constrainFrameRect(frameRect, to: screen)
        guard let visible = (screen ?? NSScreen.screens.first)?.visibleFrame else { return rect }
        if rect.width > visible.width { rect.size.width = visible.width }
        if rect.height > visible.height { rect.size.height = visible.height }
        rect.origin.x = min(max(rect.origin.x, visible.minX), visible.maxX - rect.width)
        rect.origin.y = min(max(rect.origin.y, visible.minY), visible.maxY - rect.height)
        return rect
    }
}

/* A transparent native overlay must never turn page buttons into window
   dragging targets. Only small, explicitly reported blank toolbar regions
   accept input; the rest of the overlay passes straight through to WebKit. */
final class WindowDragArea: NSView {
    weak var sourceWebView: WKWebView?
    private var regions: [NSRect] = []
    private var viewport = NSSize.zero

    func update(regions: [NSRect], viewport: NSSize) {
        self.regions = regions
        self.viewport = viewport
    }

    func invalidateRegions() { regions.removeAll() }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard !isHidden, let source = sourceWebView, source.superview != nil,
              viewport.width > 0, viewport.height > 0,
              source.bounds.width > 0, source.bounds.height > 0 else { return nil }
        let local = source.convert(point, from: superview)
        guard source.bounds.contains(local) else { return nil }
        let cssPoint = NSPoint(
            x: (local.x - source.bounds.minX) * viewport.width / source.bounds.width,
            y: (source.isFlipped ? local.y - source.bounds.minY : source.bounds.maxY - local.y) * viewport.height / source.bounds.height
        )
        guard regions.contains(where: { $0.contains(cssPoint) }) else { return nil }
        return super.hitTest(point)
    }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

/* A narrow native drag target between chat and the browser workspace. Keeping
   resizing outside WebKit avoids pointer loss when either page is repainting. */
final class BrowserResizeHandle: NSView {
    var onDrag: ((CGFloat) -> Void)?
    private var previousX: CGFloat?

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .resizeLeftRight)
    }

    override func mouseDown(with event: NSEvent) {
        previousX = event.locationInWindow.x
    }

    override func mouseDragged(with event: NSEvent) {
        guard let previousX else { return }
        let currentX = event.locationInWindow.x
        self.previousX = currentX
        onDrag?(previousX - currentX)
    }

    override func mouseUp(with event: NSEvent) {
        previousX = nil
    }
}

class BrowserPanelDragHandle: NSView {
    var onDrag: ((NSPoint) -> Void)?
    var onDragBegan: (() -> Void)?
    var onDragEnded: (() -> Void)?
    var enabled = true { didSet { window?.invalidateCursorRects(for: self) } }
    private var previous: NSPoint?
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { enabled }
    override func resetCursorRects() { if enabled { addCursorRect(bounds, cursor: .openHand) } }
    override func mouseDown(with event: NSEvent) {
        previous = enabled ? event.locationInWindow : nil
        if enabled { onDragBegan?() }
    }
    override func mouseDragged(with event: NSEvent) {
        guard enabled, let previous else { return }
        let point = event.locationInWindow
        self.previous = point
        onDrag?(NSPoint(x: point.x - previous.x, y: point.y - previous.y))
    }
    override func mouseUp(with event: NSEvent) {
        let wasDragging = previous != nil
        previous = nil
        if wasDragging { onDragEnded?() }
    }
}

final class BrowserToolbarHandle: BrowserPanelDragHandle {
    var onHover: ((Bool) -> Void)?
    private var hoverArea: NSTrackingArea?
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverArea { removeTrackingArea(hoverArea) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area); hoverArea = area
    }
    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false) }
}

final class BrowserPanelContainer: NSView {
    var inputSuppressed = false
    var onHover: ((Bool) -> Void)?
    private var hoverArea: NSTrackingArea?
    override func hitTest(_ point: NSPoint) -> NSView? {
        inputSuppressed ? nil : super.hitTest(point)
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverArea { removeTrackingArea(hoverArea) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area); hoverArea = area
    }
    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false) }
}

final class BrowserEdgeTab: BrowserPanelDragHandle {
    var edge: BrowserDockEdge = .right { didSet { needsDisplay = true } }
    var onHover: ((Bool) -> Void)?
    private var hoverArea: NSTrackingArea?
    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityLabel("侧边浏览器，向内拖出")
        setAccessibilityHelp("鼠标靠近露出半幅；向工作区拖动恢复悬浮")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverArea { removeTrackingArea(hoverArea) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area); hoverArea = area
    }
    override func mouseEntered(with event: NSEvent) { onHover?(true) }
    override func mouseExited(with event: NSEvent) { onHover?(false) }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemPink.withAlphaComponent(0.82).setFill()
        NSBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 0), xRadius: 8, yRadius: 8).fill()
        let symbol = edge == .right ? "chevron.left" : edge == .top ? "chevron.down" : "chevron.up"
        NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?.draw(in: NSRect(x: bounds.midX-6, y: bounds.midY-6, width: 12, height: 12))
    }
}
struct BrowserResizeEdges: OptionSet {
    let rawValue: Int
    static let left = Self(rawValue: 1)
    static let right = Self(rawValue: 2)
    static let top = Self(rawValue: 4)
    static let bottom = Self(rawValue: 8)
    static let allHandles: [Self] = [.left, .right, .top, .bottom, [.left, .top], [.right, .top], [.left, .bottom], [.right, .bottom]]
    var isCorner: Bool { (contains(.left) || contains(.right)) && (contains(.top) || contains(.bottom)) }
    var label: String { (contains(.top) ? "上" : contains(.bottom) ? "下" : "") + (contains(.left) ? "左" : contains(.right) ? "右" : "") + (isCorner ? "角" : "边") }
}

final class BrowserPanelResizeHandle: BrowserPanelDragHandle {
    let edges: BrowserResizeEdges
    init(edges: BrowserResizeEdges) {
        self.edges = edges
        super.init(frame: .zero)
        setAccessibilityElement(true)
        setAccessibilityRole(.splitter)
        setAccessibilityLabel("调整浏览器大小：" + edges.label)
        setAccessibilityHelp("按住鼠标拖动，调整悬浮浏览器大小")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func resetCursorRects() {
        guard enabled else { return }
        let cursor: NSCursor
        if edges.isCorner {
            let symbol = edges == [.left, .top] || edges == [.right, .bottom] ? "arrow.up.left.and.arrow.down.right" : "arrow.up.right.and.arrow.down.left"
            if let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) {
                cursor = NSCursor(image: image, hotSpot: NSPoint(x: image.size.width / 2, y: image.size.height / 2))
            } else { cursor = .crosshair }
        } else { cursor = edges.contains(.left) || edges.contains(.right) ? .resizeLeftRight : .resizeUpDown }
        addCursorRect(bounds, cursor: cursor)
    }
    override func draw(_ dirtyRect: NSRect) {
        guard edges == [.right, .bottom] else { return }
        NSColor.secondaryLabelColor.withAlphaComponent(0.5).setStroke()
        for offset: CGFloat in [4, 8] {
            let path = NSBezierPath(); path.move(to: NSPoint(x: bounds.maxX - offset - 3, y: 3))
            path.line(to: NSPoint(x: bounds.maxX - 3, y: offset + 3)); path.stroke()
        }
    }
}
final class BrowserPanelTitle: NSTextField {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

final class BrowserAddressField: NSSearchField {
    private(set) var editingAddress = false
    var fullAddress = ""
    var shortAddress = ""
    func show(_ url: URL) {
        fullAddress = url.absoluteString
        shortAddress = url.host.map { $0 + (url.port.map { ":\($0)" } ?? "") } ?? url.lastPathComponent
        toolTip = fullAddress
        if !editingAddress { stringValue = shortAddress }
    }
    private func beginAddress() {
        if !editingAddress { editingAddress = true; stringValue = fullAddress }
    }
    override func mouseDown(with event: NSEvent) { beginAddress(); super.mouseDown(with: event) }
    override func becomeFirstResponder() -> Bool { beginAddress(); return super.becomeFirstResponder() }
    override func selectText(_ sender: Any?) { beginAddress(); super.selectText(sender) }
    override func textDidEndEditing(_ notification: Notification) {
        super.textDidEndEditing(notification)
        editingAddress = false
        stringValue = shortAddress
    }
}

enum BrowserPresentation: String { case side, floating, full }
enum BrowserDockEdge: String { case top, bottom, right }

enum BrowserWorkspaceGeometry {
    static func fitZoom(width: CGFloat, contentWidth: CGFloat?) -> CGFloat {
        guard let contentWidth, width > 0, contentWidth > 0 else { return 1 }
        return max(0.15, min(1, width/contentWidth))
    }
    static func edgeDockedFrame(in bounds: NSRect, frame: NSRect, edge: BrowserDockEdge, revealed: Bool) -> NSRect {
        var result = floatingFrame(in: bounds, proposed: frame)
        if edge == .right {
            let visible = revealed ? result.width / 2 : 0
            result.origin.x = bounds.maxX - visible
        } else {
            let visible = revealed ? result.height / 2 : 0
            result.origin.y = edge == .top ? bounds.maxY-visible : bounds.minY-result.height+visible
        }
        return result
    }
    static func resizedFloatingFrame(in bounds: NSRect, frame: NSRect, edges: BrowserResizeEdges, delta: NSPoint) -> NSRect {
        let current = floatingFrame(in: bounds, proposed: frame)
        guard current.width > 0, current.height > 0, delta.x.isFinite, delta.y.isFinite else { return current }
        let inset = min(12, min(bounds.width, bounds.height) / 8)
        let available = bounds.insetBy(dx: inset, dy: inset)
        let minWidth = min(360, available.width), minHeight = min(260, available.height)
        var left = current.minX, right = current.maxX, bottom = current.minY, top = current.maxY
        if edges.contains(.left) { left = min(right - minWidth, max(available.minX, left + delta.x)) }
        if edges.contains(.right) { right = max(left + minWidth, min(available.maxX, right + delta.x)) }
        if edges.contains(.bottom) { bottom = min(top - minHeight, max(available.minY, bottom + delta.y)) }
        if edges.contains(.top) { top = max(bottom + minHeight, min(available.maxY, top + delta.y)) }
        return NSRect(x: left, y: bottom, width: right - left, height: top - bottom)
    }
    static func floatingFrame(in bounds: NSRect, proposed: NSRect? = nil) -> NSRect {
        guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0 else { return .zero }
        let inset = min(12, min(bounds.width, bounds.height) / 8)
        let available = bounds.insetBy(dx: inset, dy: inset)
        let initial = NSRect(x: available.maxX - min(760, available.width * 0.65), y: available.maxY - min(650, available.height * 0.78), width: min(760, available.width * 0.65), height: min(650, available.height * 0.78))
        let raw = proposed ?? initial
        let width = min(available.width, max(min(360, available.width), raw.width.isFinite ? raw.width : initial.width))
        let height = min(available.height, max(min(260, available.height), raw.height.isFinite ? raw.height : initial.height))
        let x = min(available.maxX - width, max(available.minX, raw.minX.isFinite ? raw.minX : initial.minX))
        let y = min(available.maxY - height, max(available.minY, raw.minY.isFinite ? raw.minY : initial.minY))
        return NSRect(x: x, y: y, width: width, height: height)
    }
    static func browserWidth(totalWidth: CGFloat, fraction: CGFloat) -> CGFloat {
        guard totalWidth.isFinite, totalWidth > 0 else { return 0 }
        // Keep enough room for the conversation even after leaving a much
        // wider full-screen window. Browser dragging uses the same limits.
        let maximum = max(0, totalWidth - 430)
        let minimum = min(360, maximum)
        let ratio = fraction.isFinite ? min(0.85, max(0.15, fraction)) : 0.44
        return min(maximum, max(minimum, totalWidth * ratio))
    }
}

final class MaterialDownloadContext {
    weak var webView: WKWebView?
    var destination: URL?
    var reservedPath: String?

    init(webView: WKWebView?) {
        self.webView = webView
    }
}

/// Effects are part of 碧琪's identity: they follow the in-app 减少动效 switch
/// (laolao-motion-preference.js), never the OS "reduce motion" flag, so every
/// Mac shows the same experience by default.
enum PinkieMotion {
    static var reduce: Bool {
        get { UserDefaults.standard.bool(forKey: "PinkieReduceMotion") }
        set { UserDefaults.standard.set(newValue, forKey: "PinkieReduceMotion") }
    }
}
