// File-format sniffers for upload validation. Prevents Content-Type spoofing
// (e.g. SVG-with-script relabelled as image/png) from becoming a stored-XSS
// primitive once served same-origin.

// Returns canonical extension ('jpg' | 'png' | 'webp' | 'gif') or null.
export function sniffImageExt(bytes) {
    if (bytes.length < 4) return null;
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return 'png';
    }
    // GIF: "GIF87a" or "GIF89a"
    if (bytes.length >= 6 &&
        bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
        return 'gif';
    }
    // WebP: "RIFF....WEBP"
    if (bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return 'webp';
    }
    return null;
}

// Same as sniffImageExt + PDF.
export function sniffDocExt(bytes) {
    const image = sniffImageExt(bytes);
    if (image) return image;
    if (bytes.length >= 5 &&
        bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
        bytes[3] === 0x46 && bytes[4] === 0x2d) {
        return 'pdf';
    }
    return null;
}

export const IMAGE_MIME = {
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
};

export const DOC_MIME = {
    ...IMAGE_MIME,
    pdf: 'application/pdf',
};
