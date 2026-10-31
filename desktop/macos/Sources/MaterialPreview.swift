import Foundation
import WebKit
import AppKit
import AVFoundation
import ImageIO
import QuickLookThumbnailing
import Darwin

// pinkie-material-markdown:v1
enum MaterialPreviewModePolicy {
    private static let included: Set<String> = ["chat", "project", "thinking", "learning"]

    static func allowsEnhancedMarkdown(primary: String?, companion: String?, companionVisible: Bool) -> Bool {
        guard let primary, included.contains(primary) else { return false }
        return !companionVisible || companion.map(included.contains) == true
    }
}

enum MaterialMarkdownDocument {
    static let bundledRenderer: String? = {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("SuperPinkie/ui/injections/laolao-markdown-preview.js") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }()

    private static let bundledMathScript: String? = {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("SuperPinkie/ui/injections/laolao-katex/katex.min.js") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }()
    private static let bundledMathStyle: String? = {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("SuperPinkie/ui/injections/laolao-katex/katex.min.css"),
              let css = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return css.replacingOccurrences(of: "url(fonts/", with: "url(clekk-material://katex/fonts/")
    }()

    static func content(text: String, renderer: String, nonce: String, relativeToken: String? = nil) -> String {
        let script = renderer.replacingOccurrences(of: "</script", with: "<\\/script", options: .caseInsensitive)
        let token = relativeToken?.range(of: "^[0-9a-f-]{36}$", options: [.regularExpression, .caseInsensitive]) != nil ? relativeToken! : ""
        let enhanced = !token.isEmpty
        let math = (enhanced ? bundledMathScript ?? "" : "").replacingOccurrences(of: "</script", with: "<\\/script", options: .caseInsensitive)
        return """
        <style>
        \(enhanced ? bundledMathStyle ?? "" : "")
        .markdown-body{max-width:960px;margin:0 auto;padding:28px;font:16px/1.75 -apple-system,BlinkMacSystemFont,sans-serif;overflow-wrap:anywhere}
        .markdown-body h1,.markdown-body h2,.markdown-body h3{line-height:1.4;margin:1.6em 0 .65em;font-weight:700}.markdown-body h1{font-size:1.8em;margin-top:0}.markdown-body h2{font-size:1.4em}.markdown-body h3{font-size:1.15em}
        .markdown-body p,.markdown-body ul,.markdown-body ol{margin:.8em 0}.markdown-body li{margin:.35em 0}.markdown-body strong{font-weight:700}
        .markdown-body blockquote{margin:1em 0;padding:.1em 1em;border-left:3px solid var(--accent,#b283b8);opacity:.88}
        .markdown-body pre{padding:16px;margin:1em 0;background:rgba(128,128,128,.1);border-radius:10px;white-space:pre;overflow:auto;overflow-wrap:normal;line-height:1.6}
        .markdown-body code{font:13.5px/1.6 ui-monospace,monospace}.markdown-body :not(pre)>code{padding:.15em .35em;border-radius:4px;background:rgba(128,128,128,.12)}
        .markdown-body .markdown-table{overflow-x:auto;margin:1em 0}.markdown-body table{width:100%;border-collapse:collapse;font-size:.94em}.markdown-body th,.markdown-body td{padding:9px 12px;text-align:left;border:1px solid rgba(128,128,128,.25)}.markdown-body th{background:rgba(128,128,128,.1)}
        .markdown-body a{color:var(--accent,#9770ae)}.markdown-body img{max-width:100%;height:auto}.markdown-body hr{border:0;border-top:1px solid rgba(128,128,128,.25);margin:1.5em 0}.markdown-body.markdown-plain{white-space:pre-wrap}
        .markdown-body .pinkie-preview-math--display{display:block;overflow-x:auto}
        @media(max-width:600px){.markdown-body{padding:18px;font-size:15px}}
        </style><article class="markdown-body" id="pinkie-markdown-document"><pre id="pinkie-markdown-source">\(escape(text))</pre></article><script nonce="\(escape(nonce))">\(math);window.__pinkieMarkdownEnhanced=\(enhanced ? "true" : "false");window.__pinkieMarkdownAssetToken="\(token)";\(script)</script>
        """
    }

    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }
}

private struct MaterialThumbnailFingerprint: Equatable {
    let url: URL
    let size: Int64
    let modified: Date
    let fileNumber: UInt64

    init(file: MaterialPreviewFile) throws {
        let attributes = try FileManager.default.attributesOfItem(atPath: file.url.path)
        url = file.url
        size = file.size
        modified = attributes[.modificationDate] as? Date ?? .distantPast
        fileNumber = (attributes[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0
    }
}

private final class MaterialDescriptionJob {
    private let lock = NSLock()
    private var finished = false
    private var fallback: [String: Any] = ["ok": false, "message": "读取文件信息超时，请稍后再试。"]
    private var cancellation: (() -> Void)?
    private let completion: ([String: Any]) -> Void

    init(completion: @escaping ([String: Any]) -> Void) { self.completion = completion }
    var pending: Bool { lock.lock(); defer { lock.unlock() }; return !finished }
    func setFallback(_ value: [String: Any]) { lock.lock(); fallback = value; lock.unlock() }
    func setCancellation(_ cancel: @escaping () -> Void) {
        lock.lock()
        if finished { lock.unlock(); cancel(); return }
        cancellation = cancel
        lock.unlock()
    }
    func expire() { lock.lock(); let result = fallback; lock.unlock(); finish(result) }
    func finish(_ result: [String: Any]) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let cancel = cancellation
        cancellation = nil
        lock.unlock()
        cancel?()
        DispatchQueue.main.async { self.completion(result) }
    }
}

enum MaterialPreviewKind: String {
    case image, pdf, html, video, audio, text, external
}

struct MaterialPreviewFile {
    let url: URL
    let mimeType: String
    let kind: MaterialPreviewKind
    let size: Int64
}

enum MaterialPreviewFileError: LocalizedError {
    case invalidPath
    case outsideHome
    case sensitivePath
    case missing
    case notRegularFile
    case tooLarge(String)
    case unsupported

    var errorDescription: String? {
        switch self {
        case .invalidPath: return "文件路径无效。"
        case .outsideHome: return "为保护系统文件，只能打开用户主目录里的文件。"
        case .sensitivePath: return "这个位置包含密钥或 CLE Kk 配置，不能从聊天里打开。"
        case .missing: return "这个文件已经不在原来的位置了。"
        case .notRegularFile: return "这里只能打开文件，不能打开文件夹。"
        case .tooLarge(let limit): return "这个文件超过 \(limit)，暂时不能预览。"
        case .unsupported: return "暂时无法预览这种文件。"
        }
    }
}

enum MaterialDownloadPolicy {
    static func navigationActionRequiresDownload(_ shouldPerformDownload: Bool) -> Bool {
        shouldPerformDownload
    }

    static func responseRequiresDownload(contentDisposition: String?, canShowMIMEType: Bool) -> Bool {
        !canShowMIMEType || contentDisposition?.lowercased().contains("attachment") == true
    }
}

enum MaterialPreviewUserMessage {
    static func text(for error: Error) -> String {
        if let known = error as? MaterialPreviewFileError { return known.localizedDescription }
        let value = error as NSError
        if value.domain == NSCocoaErrorDomain && value.code == CocoaError.fileNoSuchFile.rawValue {
            return "这个文件已经不在原来的位置了。"
        }
        if value.domain == NSCocoaErrorDomain && value.code == CocoaError.fileReadNoPermission.rawValue {
            return "没有权限读取这个文件，请检查文件权限。"
        }
        return "读取或保存文件失败，请检查文件权限、磁盘空间后重试。"
    }
}

final class MaterialPreviewFileAccess {
    private let home: URL

    init(homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser) {
        self.home = homeDirectory.resolvingSymlinksInPath().standardizedFileURL
    }

    func validatedFile(path rawPath: String) throws -> URL {
        let clean = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, !clean.contains("\0") else { throw MaterialPreviewFileError.invalidPath }
        let expanded: String
        if clean == "~" {
            expanded = home.path
        } else if clean.hasPrefix("~/") {
            expanded = home.appendingPathComponent(String(clean.dropFirst(2))).path
        } else {
            expanded = clean
        }
        let requested = URL(fileURLWithPath: expanded).standardizedFileURL
        let resolved = requested.resolvingSymlinksInPath().standardizedFileURL
        let homePath = home.path.hasSuffix("/") ? String(home.path.dropLast()) : home.path
        guard resolved.path.hasPrefix(homePath + "/") else { throw MaterialPreviewFileError.outsideHome }

        let relative = String(resolved.path.dropFirst(homePath.count + 1))
            .split(separator: "/")
            .map(String.init)
        let lower = relative.map { $0.lowercased() }
        let isOpenClawWorkspace = lower.count >= 2 && lower[0] == ".openclaw"
            && (lower[1] == "workspace" || lower[1].hasPrefix("workspace-"))
        if lower.first == ".ssh"
            || (lower.count >= 2 && lower[0] == "library" && lower[1] == "keychains")
            || (lower.first == ".openclaw" && !isOpenClawWorkspace) {
            throw MaterialPreviewFileError.sensitivePath
        }

        guard FileManager.default.fileExists(atPath: resolved.path) else { throw MaterialPreviewFileError.missing }
        let attributes = try FileManager.default.attributesOfItem(atPath: resolved.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular else {
            throw MaterialPreviewFileError.notRegularFile
        }
        return resolved
    }

    /// "Open with the default app" is reachable from paths in model output, so
    /// it only hands documents to their viewers. Scripts, installers and other
    /// files that macOS would execute are refused.
    static let defaultAppDocumentExtensions: Set<String> = [
        "pdf", "txt", "md", "markdown", "rtf", "rtfd", "csv", "tsv", "json", "log",
        "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
        "key", "pages", "numbers", "epub",
        "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "svg", "psd", "ai",
        "mp4", "mov", "m4v", "webm", "mkv", "avi", "mp3", "m4a", "wav", "aac", "flac",
        "srt", "ass", "vtt", "zip",
    ]

    static func canOpenWithDefaultApp(_ url: URL) -> Bool {
        defaultAppDocumentExtensions.contains(url.pathExtension.lowercased())
    }

    func previewFile(path rawPath: String) throws -> MaterialPreviewFile {
        let url = try validatedFile(path: rawPath)
        let size = ((try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? NSNumber)?.int64Value ?? 0
        let ext = url.pathExtension.lowercased()
        let description = Self.type(for: ext)
        return MaterialPreviewFile(url: url, mimeType: description.mime, kind: description.kind, size: size)
    }

    static func type(for ext: String) -> (mime: String, kind: MaterialPreviewKind) {
        switch ext.lowercased() {
        case "pdf": return ("application/pdf", .pdf)
        case "html", "htm": return ("text/html", .html)
        case "png": return ("image/png", .image)
        case "jpg", "jpeg": return ("image/jpeg", .image)
        case "gif": return ("image/gif", .image)
        case "webp": return ("image/webp", .image)
        case "avif": return ("image/avif", .image)
        case "bmp": return ("image/bmp", .image)
        case "tif", "tiff": return ("image/tiff", .image)
        case "heic", "heif": return ("image/heic", .image)
        case "svg": return ("image/svg+xml", .image)
        case "mp4": return ("video/mp4", .video)
        case "mov": return ("video/quicktime", .video)
        case "m4v": return ("video/x-m4v", .video)
        case "webm": return ("video/webm", .video)
        case "mp3": return ("audio/mpeg", .audio)
        case "m4a": return ("audio/mp4", .audio)
        case "wav": return ("audio/wav", .audio)
        case "md", "markdown", "txt", "text", "log", "csv", "tsv",
             "json", "yaml", "yml", "xml", "toml", "ini", "conf",
             "swift", "py", "js", "mjs", "cjs", "ts", "tsx", "jsx",
             "htmlcode", "css", "scss", "sh", "bash", "zsh", "c", "h",
             "cpp", "hpp", "rs", "go", "java", "kt", "rb", "php", "sql",
             "diff", "patch", "plist": return ("text/plain", .text)
        default: return ("application/octet-stream", .external)
        }
    }

    func enforcePreviewSize(_ file: MaterialPreviewFile) throws {
        switch file.kind {
        case .video, .audio:
            // Media is streamed in byte ranges; its size does not control memory use.
            return
        case .image:
            guard file.size <= 64 * 1024 * 1024 else { throw MaterialPreviewFileError.tooLarge("64 MB") }
        case .pdf:
            guard file.size <= 128 * 1024 * 1024 else { throw MaterialPreviewFileError.tooLarge("128 MB") }
        case .html, .text:
            guard file.size <= 16 * 1024 * 1024 else { throw MaterialPreviewFileError.tooLarge("16 MB") }
        case .external:
            throw MaterialPreviewFileError.unsupported
        }
    }

    static func uniqueDownloadURL(in directory: URL, filename: String, reservedPaths: Set<String> = []) -> URL {
        let proposed = URL(fileURLWithPath: filename).lastPathComponent
        let safeName = proposed.isEmpty || proposed == "." || proposed == ".." ? "下载文件" : proposed
        let source = URL(fileURLWithPath: safeName)
        let stem = source.deletingPathExtension().lastPathComponent
        let ext = source.pathExtension
        func candidate(_ suffix: Int?) -> URL {
            let name = suffix.map { "\(stem) (\($0))" } ?? stem
            let final = ext.isEmpty ? name : "\(name).\(ext)"
            return directory.appendingPathComponent(final, isDirectory: false)
        }
        var index: Int? = nil
        while true {
            let url = candidate(index)
            if !FileManager.default.fileExists(atPath: url.path) && !reservedPaths.contains(url.path) { return url }
            index = (index ?? 1) + 1
        }
    }
}

struct MaterialPreviewResponsePlan {
    let statusCode: Int
    let offset: Int64
    let length: Int64
    let contentRange: String?

    static func make(fileSize: Int64, rangeHeader: String?) -> MaterialPreviewResponsePlan {
        guard let rangeHeader, !rangeHeader.isEmpty else {
            return MaterialPreviewResponsePlan(statusCode: 200, offset: 0, length: max(0, fileSize), contentRange: nil)
        }
        guard fileSize > 0,
              rangeHeader.lowercased().hasPrefix("bytes="),
              !rangeHeader.dropFirst(6).contains(",") else {
            return MaterialPreviewResponsePlan(statusCode: 416, offset: 0, length: 0, contentRange: "bytes */\(max(0, fileSize))")
        }
        let spec = rangeHeader.dropFirst(6).trimmingCharacters(in: .whitespaces)
        let parts = spec.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2 else {
            return MaterialPreviewResponsePlan(statusCode: 416, offset: 0, length: 0, contentRange: "bytes */\(fileSize)")
        }

        let start: Int64
        let end: Int64
        if parts[0].isEmpty {
            guard let suffix = Int64(parts[1]), suffix > 0 else {
                return MaterialPreviewResponsePlan(statusCode: 416, offset: 0, length: 0, contentRange: "bytes */\(fileSize)")
            }
            start = max(0, fileSize - suffix)
            end = fileSize - 1
        } else {
            guard let requestedStart = Int64(parts[0]), requestedStart >= 0, requestedStart < fileSize else {
                return MaterialPreviewResponsePlan(statusCode: 416, offset: 0, length: 0, contentRange: "bytes */\(fileSize)")
            }
            start = requestedStart
            if parts[1].isEmpty {
                end = fileSize - 1
            } else {
                guard let requestedEnd = Int64(parts[1]), requestedEnd >= start else {
                    return MaterialPreviewResponsePlan(statusCode: 416, offset: 0, length: 0, contentRange: "bytes */\(fileSize)")
                }
                end = min(requestedEnd, fileSize - 1)
            }
        }
        return MaterialPreviewResponsePlan(
            statusCode: 206,
            offset: start,
            length: end - start + 1,
            contentRange: "bytes \(start)-\(end)/\(fileSize)"
        )
    }
}

struct MaterialPreviewHTTPResponse {
    static func make(url: URL, file: MaterialPreviewFile, plan: MaterialPreviewResponsePlan) -> HTTPURLResponse? {
        var headers: [String: String] = [
            "Content-Type": file.kind == .text ? "text/plain; charset=utf-8" : file.mimeType,
            "Content-Length": String(plan.length),
            "Accept-Ranges": "bytes",
            "X-Content-Type-Options": "nosniff",
        ]
        if let contentRange = plan.contentRange { headers["Content-Range"] = contentRange }
        if file.kind == .html {
            headers["Content-Security-Policy"] = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'"
        }
        return HTTPURLResponse(url: url, statusCode: plan.statusCode, httpVersion: "HTTP/1.1", headerFields: headers)
    }
}

final class MaterialPreviewSchemeHandler: NSObject, WKURLSchemeHandler {
    private struct Resource {
        let file: MaterialPreviewFile
        let expiresAt: Date
    }

    private final class ReadJob {
        private let lock = NSLock()
        private var wasStopped = false
        func stop() { lock.lock(); wasStopped = true; lock.unlock() }
        var isStopped: Bool { lock.lock(); defer { lock.unlock() }; return wasStopped }
    }

    private let access = MaterialPreviewFileAccess()
    private let lock = NSLock()
    private let jobsLock = NSLock()
    private var resources: [String: Resource] = [:]
    private var workspacePages: [String: (name: String, data: Data, nonce: String)] = [:]
    private var enhancedMarkdownTokens: Set<String> = []
    private struct ThumbnailResource {
        let fingerprint: MaterialThumbnailFingerprint
        let cacheURL: URL
        let expiresAt: Date
        let width: Int
        let height: Int
    }
    private var thumbnails: [String: ThumbnailResource] = [:]
    private var thumbnailDirectory: URL?
    private var thumbnailGeneration = UUID()
    private var descriptionJobs: [UUID: MaterialDescriptionJob] = [:]
    private let thumbnailQueue = DispatchQueue(label: "com.openclaw.super-pinkie.material-thumbnails", qos: .userInitiated)
    private var jobs: [ObjectIdentifier: ReadJob] = [:]
    private let lifetime: TimeInterval = 15 * 60
    private let maximumResources = 24
    private let readQueue = DispatchQueue(label: "com.openclaw.super-pinkie.material-preview", qos: .userInitiated, attributes: .concurrent)

    private func pruneLocked(now: Date) {
        resources = resources.filter { $0.value.expiresAt > now }
        workspacePages = workspacePages.filter { resources[$0.key] != nil }
        enhancedMarkdownTokens.formIntersection(resources.keys)
        if resources.count <= maximumResources { return }
        let surplus = resources.sorted { $0.value.expiresAt < $1.value.expiresAt }
            .prefix(resources.count - maximumResources).map(\.key)
        surplus.forEach { resources.removeValue(forKey: $0) }
    }

    /// Metadata does not require preview support: Office files can still be
    /// delivered and shown with their type icon or the existing default viewer.
    func describe(path: String, timeout: TimeInterval = 7, completion: @escaping ([String: Any]) -> Void) {
        let identifier = UUID()
        let job = MaterialDescriptionJob { [weak self] result in
            if let self {
                self.lock.lock(); self.descriptionJobs.removeValue(forKey: identifier); self.lock.unlock()
            }
            completion(result)
        }
        lock.lock(); let generation = thumbnailGeneration; descriptionJobs[identifier] = job; lock.unlock()
        DispatchQueue.main.asyncAfter(deadline: .now() + min(7, max(0.01, timeout))) { job.expire() }
        thumbnailQueue.async { [weak self] in
            guard let self, job.pending else { return }
            do {
                let file = try self.access.previewFile(path: path)
                let fingerprint = try MaterialThumbnailFingerprint(file: file)
                var metadata: [String: Any] = ["ok": true, "name": file.url.lastPathComponent, "kind": file.kind.rawValue, "size": file.size]
                job.setFallback(metadata)
                if let cached = self.cachedThumbnail(fingerprint) {
                    metadata.merge(cached) { _, new in new }
                    job.finish(metadata)
                    return
                }
                let supported = file.kind == .image || file.kind == .video || file.kind == .pdf
                    || ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "key", "pages", "numbers", "rtf", "epub"].contains(file.url.pathExtension.lowercased())
                guard supported, (file.kind == .video || file.size <= 128 * 1024 * 1024),
                      (file.kind != .image || file.size <= 64 * 1024 * 1024), job.pending else { job.finish(metadata); return }
                let completed: (CGImage?) -> Void = { [weak self] image in
                    guard let self, job.pending else { return }
                    guard let image else { job.finish(metadata); return }
                    self.thumbnailQueue.async { [weak self] in
                        guard let self, job.pending else { return }
                        do {
                            let current = try self.access.previewFile(path: file.url.path)
                            guard try MaterialThumbnailFingerprint(file: current) == fingerprint else { job.finish(metadata); return }
                            var result = metadata
                            result.merge(try self.registerThumbnail(image, fingerprint: fingerprint, generation: generation)) { _, new in new }
                            job.finish(result)
                        } catch { job.finish(metadata) }
                    }
                }
                if file.kind == .image { completed(Self.imageThumbnail(file.url)); return }
                if file.kind == .video {
                    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: file.url))
                    generator.appliesPreferredTrackTransform = true
                    generator.maximumSize = CGSize(width: 384, height: 256)
                    generator.requestedTimeToleranceBefore = CMTime(seconds: 1, preferredTimescale: 600)
                    generator.requestedTimeToleranceAfter = CMTime(seconds: 1, preferredTimescale: 600)
                    job.setCancellation { generator.cancelAllCGImageGeneration() }
                    guard job.pending else { return }
                    generator.generateCGImagesAsynchronously(forTimes: [NSValue(time: CMTime(seconds: 1, preferredTimescale: 600))]) { _, image, _, result, _ in
                        completed(result == .succeeded ? image : nil)
                    }
                    return
                }
                let request = QLThumbnailGenerator.Request(fileAt: file.url, size: CGSize(width: 384, height: 256), scale: 1, representationTypes: .thumbnail)
                job.setCancellation { QLThumbnailGenerator.shared.cancel(request) }
                guard job.pending else { return }
                QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { representation, _ in
                    if let image = representation?.cgImage { completed(image) }
                    else if file.kind == .pdf {
                        self.thumbnailQueue.async { if job.pending { completed(Self.pdfThumbnail(file.url)) } }
                    }
                    else { completed(nil) }
                }
            } catch { job.finish(["ok": false, "message": MaterialPreviewUserMessage.text(for: error)]) }
        }
    }

    private func cachedThumbnail(_ fingerprint: MaterialThumbnailFingerprint) -> [String: Any]? {
        lock.lock(); defer { lock.unlock() }
        pruneThumbnailsLocked(now: Date())
        guard let (token, resource) = thumbnails.first(where: { $0.value.fingerprint == fingerprint && FileManager.default.fileExists(atPath: $0.value.cacheURL.path) }) else { return nil }
        return ["thumbnailUrl": "clekk-material://thumbnail/\(token)/preview.png", "thumbnailWidth": resource.width, "thumbnailHeight": resource.height]
    }

    private func pruneThumbnailsLocked(now: Date) {
        let expired = thumbnails.filter { $0.value.expiresAt <= now }.map(\.key)
        expired.forEach { token in
            if let resource = thumbnails.removeValue(forKey: token) { try? FileManager.default.removeItem(at: resource.cacheURL) }
        }
        if thumbnails.count >= 64 {
            let surplus = thumbnails.sorted { $0.value.expiresAt < $1.value.expiresAt }.prefix(thumbnails.count - 63).map(\.key)
            surplus.forEach { token in
                if let resource = thumbnails.removeValue(forKey: token) { try? FileManager.default.removeItem(at: resource.cacheURL) }
            }
        }
    }

    private func registerThumbnail(_ image: CGImage, fingerprint: MaterialThumbnailFingerprint, generation: UUID) throws -> [String: Any] {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { throw MaterialPreviewFileError.unsupported }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw MaterialPreviewFileError.unsupported }
        lock.lock(); defer { lock.unlock() }
        guard thumbnailGeneration == generation else { throw MaterialPreviewFileError.unsupported }
        let directory: URL
        if let existing = thumbnailDirectory { directory = existing }
        else {
            directory = URL(fileURLWithPath: "/tmp", isDirectory: true).appendingPathComponent("pinkie-thumbnail-" + UUID().uuidString.lowercased(), isDirectory: true)
            guard Darwin.mkdir(directory.path, 0o700) == 0 else { throw MaterialPreviewFileError.unsupported }
            thumbnailDirectory = directory
        }
        let token = UUID().uuidString.lowercased()
        let cache = directory.appendingPathComponent(token + ".png")
        try (data as Data).write(to: cache, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: cache.path)
        pruneThumbnailsLocked(now: Date())
        thumbnails[token] = ThumbnailResource(fingerprint: fingerprint, cacheURL: cache, expiresAt: Date().addingTimeInterval(lifetime), width: image.width, height: image.height)
        return ["thumbnailUrl": "clekk-material://thumbnail/\(token)/preview.png", "thumbnailWidth": image.width, "thumbnailHeight": image.height]
    }

    private static func imageThumbnail(_ url: URL) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 384, kCGImageSourceShouldCacheImmediately: true,
        ] as CFDictionary)
    }

    private static func pdfThumbnail(_ url: URL) -> CGImage? {
        guard let document = CGPDFDocument(url as CFURL), let page = document.page(at: 1) else { return nil }
        let box = page.getBoxRect(.mediaBox)
        guard box.width > 0, box.height > 0 else { return nil }
        let scale = min(384 / box.width, 256 / box.height)
        let width = max(1, Int(box.width * scale)), height = max(1, Int(box.height * scale))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let rect = CGRect(x: 0, y: 0, width: width, height: height)
        context.setFillColor(NSColor.white.cgColor)
        context.fill(rect)
        context.concatenate(page.getDrawingTransform(.mediaBox, rect: rect, rotate: 0, preserveAspectRatio: true))
        context.drawPDFPage(page)
        return context.makeImage()
    }

    private func thumbnailData(for url: URL) -> Data? {
        let parts = url.pathComponents.filter { $0 != "/" }
        guard url.host == "thumbnail", parts.count == 2, parts[1] == "preview.png" else { return nil }
        lock.lock(); pruneThumbnailsLocked(now: Date()); let resource = thumbnails[parts[0]]; let directory = thumbnailDirectory; lock.unlock()
        guard let resource, let directory,
              let current = try? access.previewFile(path: resource.fingerprint.url.path),
              (try? MaterialThumbnailFingerprint(file: current)) == resource.fingerprint,
              resource.cacheURL.deletingLastPathComponent() == directory,
              resource.cacheURL.resolvingSymlinksInPath() == resource.cacheURL,
              let attributes = try? FileManager.default.attributesOfItem(atPath: resource.cacheURL.path),
              attributes[.type] as? FileAttributeType == .typeRegular else { return nil }
        return try? Data(contentsOf: resource.cacheURL)
    }

    func clearThumbnailCache() {
        lock.lock()
        let pending = Array(descriptionJobs.values)
        descriptionJobs.removeAll()
        let directory = thumbnailDirectory
        thumbnailGeneration = UUID()
        thumbnailDirectory = nil
        thumbnails.removeAll()
        lock.unlock()
        pending.forEach { $0.expire() }
        if let directory { try? FileManager.default.removeItem(at: directory) }
    }

    func register(path: String) -> [String: Any] {
        do {
            let file = try access.previewFile(path: path)
            try access.enforcePreviewSize(file)
            let now = Date()
            let token = UUID().uuidString.lowercased()
            lock.lock()
            pruneLocked(now: now)
            resources[token] = Resource(file: file, expiresAt: now.addingTimeInterval(lifetime))
            lock.unlock()
            let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
            let escapedName = file.url.lastPathComponent.addingPercentEncoding(withAllowedCharacters: allowed) ?? "file"
            return ["ok": true, "url": "clekk-material://preview/\(token)/\(escapedName)", "mimeType": file.mimeType, "kind": file.kind.rawValue]
        } catch {
            return ["ok": false, "message": MaterialPreviewUserMessage.text(for: error)]
        }
    }

    /// The sidebar page uses the same validated token and Range transport as
    /// the chat preview. Neither the address field nor the tool result shows it.
    func registerWorkspacePreview(path: String, enhancedMarkdown: Bool = false) -> [String: Any] {
        let result = register(path: path)
        guard result["ok"] as? Bool == true, let source = result["url"] as? String,
              let sourceURL = URL(string: source) else { return result }
        let parts = sourceURL.pathComponents.filter { $0 != "/" }
        guard parts.count == 2 else { return ["ok": false, "message": "无法准备文件预览。"] }
        let token = parts[0]
        do {
            let file = try access.previewFile(path: path)
            try access.enforcePreviewSize(file)
            let name = file.url.lastPathComponent
            let escapedSource = Self.workspaceEscape(source)
            let nonce = UUID().uuidString
            let content: String
            switch file.kind {
            case .video: content = "<video controls playsinline preload=\"metadata\" src=\"\(escapedSource)\"></video>"
            case .audio: content = "<main><audio controls preload=\"metadata\" src=\"\(escapedSource)\"></audio></main>"
            case .image: content = "<main><img alt=\"\(Self.workspaceEscape(name))\" src=\"\(escapedSource)\"></main>"
            case .pdf: content = "<iframe title=\"文件预览\" src=\"\(escapedSource)\"></iframe>"
            case .html: content = "<iframe title=\"网页预览\" sandbox=\"allow-scripts\" src=\"\(escapedSource)\"></iframe>"
            case .text:
                let data = try Data(contentsOf: file.url)
                let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16) ?? "这个文本的编码暂时无法显示。"
                if ["md", "markdown"].contains(file.url.pathExtension.lowercased()), let renderer = MaterialMarkdownDocument.bundledRenderer {
                    if enhancedMarkdown { lock.lock(); enhancedMarkdownTokens.insert(token); lock.unlock() }
                    content = MaterialMarkdownDocument.content(text: text, renderer: renderer, nonce: nonce, relativeToken: enhancedMarkdown ? token : nil)
                } else { content = "<pre>\(Self.workspaceEscape(text))</pre>" }
            case .external: return ["ok": false, "message": "暂时无法预览这种文件。"]
            }
            let html = """
            <!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>\(Self.workspaceEscape(name))</title>
            <style>\(CleBrowserPalette.cssVariables)*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:var(--paper);color:var(--ink);font:14px -apple-system,BlinkMacSystemFont,sans-serif}main{min-height:100%;display:grid;place-items:center;padding:20px}img{max-width:100%;max-height:calc(100vh - 40px);object-fit:contain}video,iframe{width:100%;height:100%;border:0;display:block}video{object-fit:contain;background:var(--ink)}audio{width:min(100%,580px)}pre{margin:0;padding:22px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;font:13px ui-monospace,monospace}</style></head><body>\(content)</body></html>
            """
            let pageName = name + ".html"
            lock.lock(); workspacePages[token] = (pageName, Data(html.utf8), nonce); lock.unlock()
            let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
            let escapedName = pageName.addingPercentEncoding(withAllowedCharacters: allowed) ?? "preview.html"
            return ["ok": true, "url": "clekk-material://workspace/\(token)/\(escapedName)", "name": name, "kind": file.kind.rawValue]
        } catch { return ["ok": false, "message": MaterialPreviewUserMessage.text(for: error)] }
    }

    private static func workspaceEscape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    private func workspacePage(for url: URL) -> (data: Data, nonce: String, enhancedMarkdown: Bool)? {
        let parts = url.pathComponents.filter { $0 != "/" }
        guard url.host == "workspace", parts.count == 2 else { return nil }
        lock.lock(); defer { lock.unlock() }
        pruneLocked(now: Date())
        guard let resource = resources[parts[0]], let page = workspacePages[parts[0]], page.name == parts[1],
              let current = try? access.previewFile(path: resource.file.url.path),
              current.url == resource.file.url, current.size == resource.file.size else { return nil }
        return (page.data, page.nonce, enhancedMarkdownTokens.contains(parts[0]))
    }

    private func file(for task: WKURLSchemeTask) -> MaterialPreviewFile? {
        guard let requestURL = task.request.url else { return nil }
        let components: [String]
        if requestURL.host == "relative" {
            // WebKit may decode an escaped slash in pathComponents before it
            // hands the request to us. Split the encoded path first so a nested
            // relative filename remains one capability-bound argument.
            guard let encodedPath = URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?.percentEncodedPath else { return nil }
            let pieces = encodedPath.split(separator: "/", omittingEmptySubsequences: true)
            guard pieces.count == 2, let token = String(pieces[0]).removingPercentEncoding,
                  let name = String(pieces[1]).removingPercentEncoding else { return nil }
            components = [token, name]
        } else {
            components = requestURL.pathComponents.filter { $0 != "/" }
        }
        guard components.count == 2, !components[0].isEmpty else { return nil }
        let token = components[0]
        let now = Date()
        lock.lock()
        defer { lock.unlock() }
        pruneLocked(now: now)
        guard let resource = resources[token], let current = try? access.previewFile(path: resource.file.url.path),
              current.url == resource.file.url, current.size == resource.file.size else { return nil }
        if requestURL.host == "relative" {
            let name = components[1]
            guard enhancedMarkdownTokens.contains(token), current.kind == .text, ["md", "markdown"].contains(current.url.pathExtension.lowercased()),
                  !name.isEmpty, !name.hasPrefix("/"), !name.hasPrefix("\\"), !name.hasPrefix("~"), !name.contains("\0") else { return nil }
            let path = current.url.deletingLastPathComponent().appendingPathComponent(name).standardizedFileURL.path
            guard let image = try? access.previewFile(path: path), image.kind == .image,
                  (try? access.enforcePreviewSize(image)) != nil else { return nil }
            return image
        }
        guard components[1] == resource.file.url.lastPathComponent else { return nil }
        return current
    }

    private func mathFont(for url: URL) -> Data? {
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 2, parts[0] == "fonts", parts[1].hasSuffix(".woff2"),
              parts[1].rangeOfCharacter(from: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_.-")).inverted) == nil,
              let root = Bundle.main.resourceURL?.appendingPathComponent("SuperPinkie/ui/injections/laolao-katex/fonts", isDirectory: true) else { return nil }
        let file = root.appendingPathComponent(parts[1])
        guard let data = try? Data(contentsOf: file), data.count <= 2 * 1024 * 1024 else { return nil }
        return data
    }

    private func finish(_ identifier: ObjectIdentifier) {
        jobsLock.lock(); jobs.removeValue(forKey: identifier); jobsLock.unlock()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        if let url = urlSchemeTask.request.url, url.host == "katex" {
            let identifier = ObjectIdentifier(urlSchemeTask as AnyObject)
            let job = ReadJob()
            jobsLock.lock(); jobs[identifier] = job; jobsLock.unlock()
            readQueue.async { [weak self] in
                guard let self else { return }
                defer { self.finish(identifier) }
                guard !job.isStopped else { return }
                guard let data = self.mathFont(for: url), let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                    "Content-Type": "font/woff2", "Content-Length": String(data.count), "X-Content-Type-Options": "nosniff",
                ]) else {
                    if !job.isStopped { urlSchemeTask.didFailWithError(NSError(domain: "CLEKkMaterialPreview", code: 404, userInfo: [NSLocalizedDescriptionKey: "公式字体不可用。"])) }
                    return
                }
                guard !job.isStopped else { return }
                urlSchemeTask.didReceive(response); urlSchemeTask.didReceive(data)
                if !job.isStopped { urlSchemeTask.didFinish() }
            }
            return
        }
        if let url = urlSchemeTask.request.url, url.host == "thumbnail" {
            let identifier = ObjectIdentifier(urlSchemeTask as AnyObject)
            let job = ReadJob()
            jobsLock.lock(); jobs[identifier] = job; jobsLock.unlock()
            readQueue.async { [weak self] in
                guard let self else { return }
                defer { self.finish(identifier) }
                guard !job.isStopped else { return }
                guard let data = self.thumbnailData(for: url), let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                    "Content-Type": "image/png", "Content-Length": String(data.count), "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
                ]) else {
                    if !job.isStopped { urlSchemeTask.didFailWithError(NSError(domain: "CLEKkMaterialPreview", code: 404, userInfo: [NSLocalizedDescriptionKey: "缩略图已过期或文件已变化。"])); }
                    return
                }
                guard !job.isStopped else { return }
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(data)
                if !job.isStopped { urlSchemeTask.didFinish() }
            }
            return
        }
        if let url = urlSchemeTask.request.url, url.host == "workspace" {
            guard let page = workspacePage(for: url), let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                "Content-Type": "text/html; charset=utf-8", "Content-Length": String(page.data.count), "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; script-src 'nonce-\(page.nonce)'; style-src 'unsafe-inline'; img-src clekk-material: data:;\(page.enhancedMarkdown ? " font-src clekk-material:;" : "") media-src clekk-material:; frame-src clekk-material:; object-src 'none'; base-uri 'none'; form-action 'none'",
            ]) else {
                urlSchemeTask.didFailWithError(NSError(domain: "CLEKkMaterialPreview", code: 404, userInfo: [NSLocalizedDescriptionKey: "预览地址已过期或文件已移动，请再点一次。"])); return
            }
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(page.data)
            urlSchemeTask.didFinish()
            return
        }
        guard let requestURL = urlSchemeTask.request.url, let file = file(for: urlSchemeTask) else {
            urlSchemeTask.didFailWithError(NSError(domain: "CLEKkMaterialPreview", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "预览地址已过期或文件已移动，请再点一次。",
            ]))
            return
        }
        let plan = MaterialPreviewResponsePlan.make(
            fileSize: file.size,
            rangeHeader: urlSchemeTask.request.value(forHTTPHeaderField: "Range")
        )
        guard let response = MaterialPreviewHTTPResponse.make(url: requestURL, file: file, plan: plan) else {
            urlSchemeTask.didFailWithError(NSError(domain: "CLEKkMaterialPreview", code: 500, userInfo: [NSLocalizedDescriptionKey: "无法准备文件预览。"]))
            return
        }
        let identifier = ObjectIdentifier(urlSchemeTask as AnyObject)
        let job = ReadJob()
        jobsLock.lock(); jobs[identifier] = job; jobsLock.unlock()
        readQueue.async { [weak self] in
            guard let self else { return }
            defer { self.finish(identifier) }
            urlSchemeTask.didReceive(response)
            guard plan.statusCode != 416, plan.length > 0, !job.isStopped else {
                if !job.isStopped { urlSchemeTask.didFinish() }
                return
            }
            do {
                let handle = try FileHandle(forReadingFrom: file.url)
                defer { try? handle.close() }
                try handle.seek(toOffset: UInt64(plan.offset))
                var remaining = plan.length
                while remaining > 0 && !job.isStopped {
                    let count = Int(min(256 * 1024, remaining))
                    guard let chunk = try handle.read(upToCount: count), !chunk.isEmpty else { break }
                    urlSchemeTask.didReceive(chunk)
                    remaining -= Int64(chunk.count)
                }
                if !job.isStopped {
                    if remaining == 0 { urlSchemeTask.didFinish() }
                else { urlSchemeTask.didFailWithError(NSError(domain: "CLEKkMaterialPreview", code: 500, userInfo: [NSLocalizedDescriptionKey: "读取文件时意外结束。"])) }
            }
        } catch {
                if !job.isStopped {
                    urlSchemeTask.didFailWithError(NSError(domain: "CLEKkMaterialPreview", code: 500, userInfo: [NSLocalizedDescriptionKey: MaterialPreviewUserMessage.text(for: error)]))
                }
            }
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let identifier = ObjectIdentifier(urlSchemeTask as AnyObject)
        jobsLock.lock()
        let job = jobs.removeValue(forKey: identifier)
        jobsLock.unlock()
        job?.stop()
    }

    deinit {
        clearThumbnailCache()
    }
}
