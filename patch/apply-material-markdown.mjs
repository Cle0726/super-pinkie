// Add Markdown to the current installed native material viewer. This migration
// changes only MaterialPreview.swift, preserving other agents' native sources.
const once=(source,before,after)=>{if(source.split(before).length!==2)throw Error('Material Markdown boundary changed: '+before.slice(0,75));return source.replace(before,after);};
export const marker='// pinkie-material-markdown:v1';
const helper=String.raw`${marker}
enum MaterialMarkdownDocument {
    static let bundledRenderer: String? = {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("SuperPinkie/ui/injections/laolao-markdown-preview.js") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }()

    static func content(text: String, renderer: String, nonce: String) -> String {
        let script = renderer.replacingOccurrences(of: "</script", with: "<\\/script", options: .caseInsensitive)
        return """
        <style>
        .markdown-body{max-width:960px;margin:0 auto;padding:28px;font:16px/1.75 -apple-system,BlinkMacSystemFont,sans-serif;overflow-wrap:anywhere}
        .markdown-body h1,.markdown-body h2,.markdown-body h3{line-height:1.4;margin:1.6em 0 .65em;font-weight:700}.markdown-body h1{font-size:1.8em;margin-top:0}.markdown-body h2{font-size:1.4em}.markdown-body h3{font-size:1.15em}
        .markdown-body p,.markdown-body ul,.markdown-body ol{margin:.8em 0}.markdown-body li{margin:.35em 0}.markdown-body strong{font-weight:700}
        .markdown-body blockquote{margin:1em 0;padding:.1em 1em;border-left:3px solid var(--accent,#b283b8);opacity:.88}
        .markdown-body pre{padding:16px;margin:1em 0;background:rgba(128,128,128,.1);border-radius:10px;white-space:pre;overflow:auto;overflow-wrap:normal;line-height:1.6}
        .markdown-body code{font:13.5px/1.6 ui-monospace,monospace}.markdown-body :not(pre)>code{padding:.15em .35em;border-radius:4px;background:rgba(128,128,128,.12)}
        .markdown-body .markdown-table{overflow-x:auto;margin:1em 0}.markdown-body table{width:100%;border-collapse:collapse;font-size:.94em}.markdown-body th,.markdown-body td{padding:9px 12px;text-align:left;border:1px solid rgba(128,128,128,.25)}.markdown-body th{background:rgba(128,128,128,.1)}
        .markdown-body a{color:var(--accent,#9770ae)}.markdown-body img{max-width:100%;height:auto}.markdown-body hr{border:0;border-top:1px solid rgba(128,128,128,.25);margin:1.5em 0}.markdown-body.markdown-plain{white-space:pre-wrap}
        @media(max-width:600px){.markdown-body{padding:18px;font-size:15px}}
        </style><article class="markdown-body" id="pinkie-markdown-document"><pre id="pinkie-markdown-source">\(escape(text))</pre></article><script nonce="\(escape(nonce))">\(script)</script>
        """
    }

    private static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }
}

`;
export function transformMaterialMarkdown(original){
 if(original.includes(marker))return original;
 let source=once(original,'private struct MaterialThumbnailFingerprint:',helper+'private struct MaterialThumbnailFingerprint:');
 source=once(source,'private var workspacePages: [String: (name: String, data: Data)] = [:]','private var workspacePages: [String: (name: String, data: Data, nonce: String)] = [:]');
 source=once(source,'            let content: String\n            switch file.kind {','            let nonce = UUID().uuidString\n            let content: String\n            switch file.kind {');
 source=once(source,'                content = "<pre>\\(Self.workspaceEscape(text))</pre>"',String.raw`                if ["md", "markdown"].contains(file.url.pathExtension.lowercased()), let renderer = MaterialMarkdownDocument.bundledRenderer {
                    content = MaterialMarkdownDocument.content(text: text, renderer: renderer, nonce: nonce)
                } else { content = "<pre>\(Self.workspaceEscape(text))</pre>" }`);
 source=once(source,'workspacePages[token] = (pageName, Data(html.utf8))','workspacePages[token] = (pageName, Data(html.utf8), nonce)');
 source=once(source,'private func workspacePage(for url: URL) -> Data?','private func workspacePage(for url: URL) -> (data: Data, nonce: String)?');
 source=once(source,'        return page.data\n    }','        return (page.data, page.nonce)\n    }');
 source=once(source,'"Content-Type": "text/html; charset=utf-8", "Content-Length": String(page.count),','"Content-Type": "text/html; charset=utf-8", "Content-Length": String(page.data.count),');
 source=once(source,'"default-src \'none\'; style-src \'unsafe-inline\'; img-src clekk-material:; media-src clekk-material:; frame-src clekk-material:; object-src \'none\'; base-uri \'none\'; form-action \'none\'"',String.raw`"default-src 'none'; script-src 'nonce-\(page.nonce)'; style-src 'unsafe-inline'; img-src clekk-material: data:; media-src clekk-material:; frame-src clekk-material:; object-src 'none'; base-uri 'none'; form-action 'none'"`);
 source=once(source,'            urlSchemeTask.didReceive(page)\n','            urlSchemeTask.didReceive(page.data)\n');
 return source;
}
