import Foundation

@main
enum MarkdownDocumentFixture {
    static func main() throws {
        let args = CommandLine.arguments
        guard args.count == 5 else { throw NSError(domain: "MarkdownFixture", code: 1) }
        let renderer = try String(contentsOfFile: args[1], encoding: .utf8)
        let markdown = try String(contentsOfFile: args[2], encoding: .utf8)
        let body = MaterialMarkdownDocument.content(text: markdown, renderer: renderer, nonce: "isolated-markdown-nonce")
        let css = try String(contentsOfFile: args[4], encoding: .utf8)
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>\(css)</style></head><body>\(body)</body></html>
        """
        try html.write(toFile: args[3], atomically: true, encoding: .utf8)
        print("Native Markdown document generated")
    }
}
