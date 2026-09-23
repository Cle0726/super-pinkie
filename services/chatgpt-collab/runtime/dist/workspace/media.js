import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Media is deliberately bounded. The bridge is a planning/analysis connector,
// not a bulk-upload service. These limits keep a single ChatGPT tool call
// responsive while still allowing a useful batch of visual evidence.
const MAX_IMAGE_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_VIDEO_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_VISUAL_BYTES = 1_250_000;
const MAX_BATCH_BYTES = 10 * 1024 * 1024;
const MAX_ITEMS = 8;
const MAX_VIDEO_FRAMES = 6;

const VIDEO_MIMES = new Map([
    [".mp4", "video/mp4"],
    [".m4v", "video/x-m4v"],
    [".mov", "video/quicktime"],
    [".webm", "video/webm"],
    [".mkv", "video/x-matroska"],
    [".avi", "video/x-msvideo"],
]);

export class MediaError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "MediaError";
    }
}
function mediaError(code, message) {
    return new MediaError(code, message);
}

function imageMime(header) {
    if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
        return "image/png";
    if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)
        return "image/jpeg";
    if (header.length >= 6 && (header.subarray(0, 6).toString("ascii") === "GIF87a" || header.subarray(0, 6).toString("ascii") === "GIF89a"))
        return "image/gif";
    if (header.length >= 12 && header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP")
        return "image/webp";
    // HEIC is converted locally to JPEG before it is sent. ChatGPT tool clients
    // do not consistently accept HEIC as an inline MCP image.
    if (header.length >= 12 && header.subarray(4, 12).toString("ascii").startsWith("ftyp") && /hei[cfsv]|mif1/i.test(header.subarray(8, 32).toString("ascii")))
        return "image/heic";
    return null;
}

async function readHeader(file) {
    const handle = await fs.promises.open(file, "r");
    try {
        const buffer = Buffer.alloc(64);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead);
    }
    finally {
        await handle.close();
    }
}

async function resolveMedia(workspace, requested) {
    const { abs, rel } = workspace.resolve(requested);
    let stat;
    try {
        stat = await fs.promises.stat(abs);
    }
    catch {
        throw mediaError("FILE_NOT_FOUND", `媒体文件不存在：${rel}`);
    }
    if (!stat.isFile())
        throw mediaError("NOT_A_FILE", `媒体路径不是普通文件：${rel}`);
    return { abs, rel, stat };
}

function temporaryDirectory(label) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `pinkie-${label}-`));
}

function removeTemporaryDirectory(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    catch {
        // Best effort only. The directory contains generated previews, never
        // original workspace media.
    }
}

function sipsPath() {
    return process.platform === "darwin" && fs.existsSync("/usr/bin/sips") ? "/usr/bin/sips" : null;
}

function createJpegPreview(source, dir, stem, maxBytes) {
    const sips = sipsPath();
    if (!sips)
        throw mediaError("MEDIA_PREVIEW_UNAVAILABLE", "这张图片需要压缩后才能发送，但当前系统没有可用的本机图片转换器。");
    const output = path.join(dir, `${stem}.jpg`);
    for (const edge of [1920, 1600, 1280, 960, 720]) {
        const result = spawnSync(sips, ["-s", "format", "jpeg", "-s", "formatOptions", "72", "-Z", String(edge), source, "--out", output], {
            encoding: "utf8",
            timeout: 30_000,
            maxBuffer: 256 * 1024,
        });
        if (result.status !== 0 || !fs.existsSync(output))
            continue;
        const bytes = fs.statSync(output).size;
        if (bytes > 0 && bytes <= maxBytes)
            return { file: output, bytes, mimeType: "image/jpeg", transformed: true };
    }
    throw mediaError("MEDIA_TOO_LARGE", "图片预览仍然过大；请拆分选择或先缩小图片后再分析。");
}

async function imageVisual(source, mimeType, bytes, dir, stem, maxBytes) {
    // Keep normal images byte-for-byte when they are already small enough.
    // This avoids altering diagrams, screenshots and other detail-heavy assets.
    if (mimeType !== "image/heic" && bytes <= maxBytes) {
        return {
            data: await fs.promises.readFile(source),
            mimeType,
            bytes,
            transformed: false,
        };
    }
    const preview = createJpegPreview(source, dir, stem, maxBytes);
    return {
        data: await fs.promises.readFile(preview.file),
        mimeType: preview.mimeType,
        bytes: preview.bytes,
        transformed: preview.transformed,
    };
}

function videoMime(file) {
    return VIDEO_MIMES.get(path.extname(file).toLowerCase()) ?? null;
}

function probeVideo(source, rel) {
    const probe = spawnSync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,pix_fmt,sample_rate",
        "-of", "json",
        source,
    ], { encoding: "utf8", timeout: 25_000, maxBuffer: 1024 * 1024 });
    if (probe.error?.code === "ENOENT")
        throw mediaError("VIDEO_ANALYSIS_UNAVAILABLE", "本机没有可用的视频分析组件，暂时不能从视频抽取关键帧。");
    if (probe.status !== 0)
        throw mediaError("INVALID_VIDEO", `无法解析视频：${rel}`);
    let data;
    try {
        data = JSON.parse(probe.stdout || "{}");
    }
    catch {
        throw mediaError("INVALID_VIDEO", `视频探测结果无效：${rel}`);
    }
    const video = (data.streams ?? []).find((stream) => stream.codec_type === "video");
    if (!video)
        throw mediaError("INVALID_VIDEO", `文件不包含可分析的视频画面：${rel}`);
    const duration = Number(data.format?.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0)
        throw mediaError("INVALID_VIDEO", `视频时长无效：${rel}`);
    const audio = (data.streams ?? []).find((stream) => stream.codec_type === "audio");
    return { duration, video, audio };
}

function frameTimes(duration, count) {
    // Avoid title/end slates: take evenly-spaced views through the middle 84%.
    return Array.from({ length: count }, (_unused, index) => duration * (0.08 + ((index + 1) / (count + 1)) * 0.84));
}

async function videoVisuals(source, rel, stat, frameCount, dir, byteBudget) {
    if (stat.size > MAX_VIDEO_SOURCE_BYTES)
        throw mediaError("MEDIA_TOO_LARGE", `视频超过 ${Math.floor(MAX_VIDEO_SOURCE_BYTES / 1024 / 1024 / 1024)}GB 的安全分析上限：${rel}`);
    const details = probeVideo(source, rel);
    const count = Math.min(MAX_VIDEO_FRAMES, Math.max(1, Math.floor(frameCount ?? 4)));
    const frames = [];
    const perFrameBudget = Math.min(MAX_VISUAL_BYTES, Math.max(350_000, Math.floor(byteBudget / count)));
    for (const [index, seconds] of frameTimes(details.duration, count).entries()) {
        const output = path.join(dir, `frame-${index + 1}.jpg`);
        const extracted = spawnSync("ffmpeg", [
            "-v", "error", "-ss", seconds.toFixed(3), "-i", source,
            "-frames:v", "1", "-vf", "scale='min(1920,iw)':-2", "-q:v", "4", "-y", output,
        ], { encoding: "utf8", timeout: 35_000, maxBuffer: 1024 * 1024 });
        if (extracted.error?.code === "ENOENT")
            throw mediaError("VIDEO_ANALYSIS_UNAVAILABLE", "本机没有可用的视频抽帧组件，暂时不能分析视频画面。");
        if (extracted.status !== 0 || !fs.existsSync(output))
            throw mediaError("VIDEO_FRAME_FAILED", `无法抽取视频关键帧：${rel}`);
        const visual = await imageVisual(output, "image/jpeg", fs.statSync(output).size, dir, `frame-preview-${index + 1}`, perFrameBudget);
        frames.push({
            content: { type: "image", data: visual.data.toString("base64"), mimeType: visual.mimeType },
            bytes: visual.bytes,
            timestampSeconds: Number(seconds.toFixed(2)),
            transformed: visual.transformed,
        });
    }
    return {
        frames,
        metadata: {
            durationSeconds: Number(details.duration.toFixed(2)),
            width: Number(details.video.width) || null,
            height: Number(details.video.height) || null,
            videoCodec: details.video.codec_name ?? null,
            hasAudio: Boolean(details.audio),
            audioCodec: details.audio?.codec_name ?? null,
        },
    };
}

/**
 * Creates inline MCP image content for files that the ChatGPT model explicitly
 * names. It never enumerates a directory, reads a project file without a path,
 * uploads the original video, or keeps generated preview files.
 */
export async function prepareMediaBatch(workspace, paths, opts = {}) {
    if (!Array.isArray(paths) || paths.length === 0)
        throw mediaError("INVALID_ARGUMENTS", "至少选择一个图片或视频文件。");
    if (paths.length > MAX_ITEMS)
        throw mediaError("TOO_MANY_MEDIA_FILES", `一次最多分析 ${MAX_ITEMS} 个媒体文件。`);
    const directory = temporaryDirectory("web-gpt-media");
    try {
        const items = [];
        const visuals = [];
        let sentBytes = 0;
        const remainingBudget = () => MAX_BATCH_BYTES - sentBytes;
        for (const [index, requested] of paths.entries()) {
            const { abs, rel, stat } = await resolveMedia(workspace, requested);
            const header = await readHeader(abs);
            const mimeType = imageMime(header);
            if (mimeType) {
                if (stat.size > MAX_IMAGE_SOURCE_BYTES)
                    throw mediaError("MEDIA_TOO_LARGE", `图片超过 ${Math.floor(MAX_IMAGE_SOURCE_BYTES / 1024 / 1024)}MB 的安全分析上限：${rel}`);
                const visual = await imageVisual(abs, mimeType, stat.size, directory, `image-${index + 1}`, Math.min(MAX_VISUAL_BYTES, remainingBudget()));
                if (visual.bytes > remainingBudget())
                    throw mediaError("MEDIA_BATCH_TOO_LARGE", "本批媒体预览超过 10MB；请减少文件数量或分两次分析。");
                sentBytes += visual.bytes;
                visuals.push({ type: "image", data: visual.data.toString("base64"), mimeType: visual.mimeType });
                items.push({ path: rel, kind: "image", sourceBytes: stat.size, sentBytes: visual.bytes, transformed: visual.transformed });
                continue;
            }
            if (!videoMime(abs))
                throw mediaError("UNSUPPORTED_MEDIA", `仅支持 PNG、JPEG、GIF、WebP、HEIC 和常见视频格式：${rel}`);
            const extracted = await videoVisuals(abs, rel, stat, opts.videoFrames, directory, remainingBudget());
            const frameBytes = extracted.frames.reduce((total, frame) => total + frame.bytes, 0);
            if (frameBytes > remainingBudget())
                throw mediaError("MEDIA_BATCH_TOO_LARGE", "本批视频关键帧超过 10MB；请减少视频数量或每段抽帧数。");
            sentBytes += frameBytes;
            visuals.push(...extracted.frames.map((frame) => frame.content));
            items.push({
                path: rel,
                kind: "video-keyframes",
                sourceBytes: stat.size,
                sentBytes: frameBytes,
                frameCount: extracted.frames.length,
                ...extracted.metadata,
            });
        }
        return { items, visuals, sentBytes, source: "explicit-user-selected-media" };
    }
    finally {
        removeTemporaryDirectory(directory);
    }
}
