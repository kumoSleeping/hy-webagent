import type { EditorMediaType } from "../../types";

interface MediaPreviewProps {
  dataUrl: string;
  mediaType: EditorMediaType;
  name: string;
}

export function MediaPreview({ dataUrl, mediaType, name }: MediaPreviewProps) {
  if (mediaType === "image") {
    return (
      <div className="absolute inset-0 flex items-center justify-center overflow-auto p-4" style={{ background: "#ffffff" }}>
        <img
          src={dataUrl}
          alt={name}
          className="max-w-full max-h-full object-contain shadow-sm"
          style={{ background: "#ffffff" }}
        />
      </div>
    );
  }

  if (mediaType === "audio") {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6" style={{ background: "#ffffff" }}>
        <audio controls src={dataUrl} className="w-full max-w-md">
          Your browser does not support the audio element.
        </audio>
      </div>
    );
  }

  if (mediaType === "video") {
    return (
      <div className="absolute inset-0 flex items-center justify-center overflow-auto p-4" style={{ background: "#ffffff" }}>
        <video controls src={dataUrl} className="max-w-full max-h-full">
          Your browser does not support the video element.
        </video>
      </div>
    );
  }

  if (mediaType === "pdf") {
    return (
      <div className="absolute inset-0" style={{ background: "#ffffff" }}>
        <iframe
          src={dataUrl}
          title={name}
          className="h-full w-full border-0"
        />
      </div>
    );
  }

  return null;
}
