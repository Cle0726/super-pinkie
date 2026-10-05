import Foundation
import WebKit

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
    private var jobs: [ObjectIdentifier: ReadJob] = [:]
    private let lifetime: TimeInterval = 15 * 60
    private let maximumResources = 24
    private let readQueue = DispatchQueue(label: "com.openclaw.super-pinkie.material-preview", qos: .userInitiated, attributes: .concurrent)

    private func pruneLocked(now: Date) {
        resources = resources.filter { $0.value.expiresAt > now }
        if resources.count <= maximumResources { return }
        let surplus = resources.sorted { $0.value.expiresAt < $1.value.expiresAt }
            .prefix(resources.count - maximumResources).map(\.key)
        surplus.forEach { resources.removeValue(forKey: $0) }
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

    private func file(for task: WKURLSchemeTask) -> MaterialPreviewFile? {
        guard let requestURL = task.request.url else { return nil }
        let components = requestURL.pathComponents.filter { $0 != "/" }
        guard components.count == 2, !components[0].isEmpty else { return nil }
        let token = components[0]
        let now = Date()
        lock.lock()
        defer { lock.unlock() }
        pruneLocked(now: now)
        guard let resource = resources[token], components[1] == resource.file.url.lastPathComponent,
              let current = try? access.previewFile(path: resource.file.url.path),
              current.url == resource.file.url, current.size == resource.file.size else { return nil }
        return current
    }

    private func finish(_ identifier: ObjectIdentifier) {
        jobsLock.lock(); jobs.removeValue(forKey: identifier); jobsLock.unlock()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
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
}
