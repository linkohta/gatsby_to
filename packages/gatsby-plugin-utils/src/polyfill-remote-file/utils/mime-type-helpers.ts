import mime from "mime"

export type ImageFormat = "jpg" | "png" | "webp" | "avif" | "auto"

export function getImageFormatFromMimeType(mimeType: string): ImageFormat {
  return mimeType
    .replace(`image/jpeg`, `image/jpg`)
    .replace(`image/`, ``) as ImageFormat
}

export function getFileExtensionFromMimeType(mimeType: string): string {
  // jpeg を jpg に変換する。null を返す場合は拡張子を補う
  return mime.getExtension(mimeType)?.replace(`jpeg`, `jpg`) ?? `gatsby`
}
