import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { markdownComponents } from "../chat/markdownComponents";

interface MarkdownPreviewProps {
  content: string;
  onEnterEdit: () => void;
}

export function MarkdownPreview({ content, onEnterEdit }: MarkdownPreviewProps) {
  return (
    <div
      className="pi-editor-md-preview pi-markdown pi-scrollbar"
      onDoubleClick={onEnterEdit}
      title="双击进入编辑"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
