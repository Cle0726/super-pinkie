import Foundation

@main
enum MaterialPreviewNativeTests {
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        guard condition() else {
            throw NSError(domain: "MaterialPreviewNativeTests", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        }
    }

    static func expectDenied(_ access: MaterialPreviewFileAccess, _ path: String, message: String) throws {
        do {
            _ = try access.validatedFile(path: path)
            throw NSError(domain: "MaterialPreviewNativeTests", code: 2, userInfo: [NSLocalizedDescriptionKey: message])
        } catch let error as MaterialPreviewFileError {
            switch error {
            case .outsideHome, .sensitivePath: return
            default: throw error
            }
        }
    }

    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("material-preview-test-\(UUID().uuidString)", isDirectory: true)
        let home = root.appendingPathComponent("home", isDirectory: true)
        let outside = root.appendingPathComponent("outside", isDirectory: true)
        let downloads = home.appendingPathComponent("Downloads", isDirectory: true)
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let access = MaterialPreviewFileAccess(homeDirectory: home)
        let note = home.appendingPathComponent("answer.md")
        try Data("hello".utf8).write(to: note)
        let checkedNote = try access.validatedFile(path: note.path)
        try expect(checkedNote == note, "普通主目录文件应可打开")

        let ssh = home.appendingPathComponent(".ssh", isDirectory: true)
        let keychains = home.appendingPathComponent("Library/Keychains", isDirectory: true)
        let openclaw = home.appendingPathComponent(".openclaw", isDirectory: true)
        try FileManager.default.createDirectory(at: ssh, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: keychains, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: openclaw, withIntermediateDirectories: true)
        let sshKey = ssh.appendingPathComponent("id_ed25519")
        let keychain = keychains.appendingPathComponent("login.keychain-db")
        let config = openclaw.appendingPathComponent("openclaw.json")
        let credentialsDirectory = openclaw.appendingPathComponent("config", isDirectory: true)
        try FileManager.default.createDirectory(at: credentialsDirectory, withIntermediateDirectories: true)
        let credentials = credentialsDirectory.appendingPathComponent("credentials.json")
        let outsideFile = outside.appendingPathComponent("secret.txt")
        try Data("secret".utf8).write(to: sshKey)
        try Data("secret".utf8).write(to: keychain)
        try Data("secret".utf8).write(to: config)
        try Data("secret".utf8).write(to: credentials)
        try Data("secret".utf8).write(to: outsideFile)
        try expectDenied(access, sshKey.path, message: "~/.ssh 不应可读")
        try expectDenied(access, keychain.path, message: "Keychains 不应可读")
        try expectDenied(access, config.path, message: "openclaw.json 不应可读")
        try expectDenied(access, credentials.path, message: ".openclaw 配置目录不应可读")
        try expectDenied(access, outsideFile.path, message: "主目录外文件不应可读")
        let escape = home.appendingPathComponent("outside-link")
        try FileManager.default.createSymbolicLink(at: escape, withDestinationURL: outsideFile)
        try expectDenied(access, escape.path, message: "越出主目录的符号链接不应可读")

        let rangePlan = MaterialPreviewResponsePlan.make(fileSize: 10, rangeHeader: "bytes=1-4")
        try expect(rangePlan.statusCode == 206, "Range 请求应返回 206")
        try expect(rangePlan.offset == 1 && rangePlan.length == 4, "Range 响应长度和起点应正确")
        try expect(rangePlan.contentRange == "bytes 1-4/10", "Range 响应应带 Content-Range")
        let mediaURL = URL(string: "clekk-material://preview/token/sample.mp4")!
        let media = MaterialPreviewFile(url: note, mimeType: "video/mp4", kind: .video, size: 150 * 1024 * 1024)
        let response = MaterialPreviewHTTPResponse.make(url: mediaURL, file: media, plan: rangePlan)
        try expect(response?.statusCode == 206, "WKURLSchemeHandler 的 Range 响应应保留 206")
        try expect(response?.value(forHTTPHeaderField: "Content-Range") == "bytes 1-4/10", "WKURLSchemeHandler 应返回 Content-Range")
        try access.enforcePreviewSize(media)

        let existing = downloads.appendingPathComponent("report.csv")
        try Data("old".utf8).write(to: existing)
        let next = MaterialPreviewFileAccess.uniqueDownloadURL(in: downloads, filename: "report.csv")
        try expect(next.lastPathComponent == "report (2).csv", "下载文件重名时应安全改名")
        try expect(next.deletingLastPathComponent() == downloads, "下载目标应位于 Downloads")
        let saved = MaterialPreviewFileAccess.uniqueDownloadURL(in: downloads, filename: note.lastPathComponent)
        try FileManager.default.copyItem(at: note, to: saved)
        let savedBytes = try Data(contentsOf: saved)
        try expect(savedBytes == Data("hello".utf8), "文件副本应实际写入下载目录")

        try expect(MaterialDownloadPolicy.responseRequiresDownload(contentDisposition: "attachment; filename=video.mp4", canShowMIMEType: true), "attachment 响应应转为下载")
        try expect(MaterialDownloadPolicy.responseRequiresDownload(contentDisposition: nil, canShowMIMEType: false), "WebKit 不能显示的响应应转为下载")
        try expect(!MaterialDownloadPolicy.responseRequiresDownload(contentDisposition: "inline", canShowMIMEType: true), "正常可显示响应应继续导航")
        try expect(MaterialDownloadPolicy.navigationActionRequiresDownload(true), "download 导航动作应转为下载")
        try expect(!MaterialDownloadPolicy.navigationActionRequiresDownload(false), "普通导航动作应保留")

        print("MaterialPreview native checks passed")
    }
}
