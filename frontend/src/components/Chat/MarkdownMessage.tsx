import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

const components: Components = {
  // Headings
  h1: ({ children }) => (
    <h1 style={{ fontSize: 15, fontWeight: 700, color: "#0e1a2b", margin: "12px 0 6px" }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      style={{
        fontSize: 12,
        fontWeight: 700,
        color: "#016ac9",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        margin: "14px 0 6px",
        paddingBottom: 4,
        borderBottom: "1px solid #e2e8f0",
      }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", margin: "10px 0 4px" }}>
      {children}
    </h3>
  ),

  // Paragraph
  p: ({ children }) => (
    <p style={{ margin: "4px 0", lineHeight: 1.6, color: "#1e293b" }}>{children}</p>
  ),

  // Strong / Em
  strong: ({ children }) => (
    <strong style={{ fontWeight: 700, color: "#0e1a2b" }}>{children}</strong>
  ),
  em: ({ children }) => (
    <em style={{ fontStyle: "italic", color: "#64748b" }}>{children}</em>
  ),

  // Blockquote — used for single field callouts
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: "3px solid #016ac9",
        margin: "8px 0",
        padding: "6px 12px",
        background: "#eff6ff",
        borderRadius: "0 6px 6px 0",
        color: "#1e293b",
      }}
    >
      {children}
    </blockquote>
  ),

  // Inline code — for IDs, filenames, status values
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-")
    if (isBlock) {
      return (
        <pre
          style={{
            background: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            padding: "8px 12px",
            overflowX: "auto",
            fontSize: 12,
            margin: "8px 0",
          }}
        >
          <code style={{ color: "#0e1a2b", fontFamily: "monospace" }}>{children}</code>
        </pre>
      )
    }
    return (
      <code
        style={{
          background: "#f1f5f9",
          border: "1px solid #e2e8f0",
          borderRadius: 4,
          padding: "1px 5px",
          fontSize: 12,
          color: "#016ac9",
          fontFamily: "monospace",
        }}
      >
        {children}
      </code>
    )
  },

  // Lists
  ul: ({ children }) => (
    <ul style={{ margin: "6px 0", paddingLeft: 18, listStyleType: "disc" }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: "6px 0", paddingLeft: 18 }}>{children}</ol>
  ),
  li: ({ children }) => (
    <li style={{ margin: "3px 0", lineHeight: 1.55, color: "#1e293b" }}>{children}</li>
  ),

  // Tables
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "10px 0" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12.5,
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ background: "#016ac9", color: "#fff" }}>{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children, ...props }) => {
    return (
      <tr
        style={{
          borderBottom: "1px solid #e2e8f0",
        }}
        {...props}
      >
        {children}
      </tr>
    )
  },
  th: ({ children }) => (
    <th
      style={{
        padding: "7px 12px",
        textAlign: "left",
        fontWeight: 600,
        fontSize: 11.5,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "#fff",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        padding: "6px 12px",
        color: "#1e293b",
        borderRight: "1px solid #f1f5f9",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  ),

  // Horizontal rule
  hr: () => <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "10px 0" }} />,
}

interface MarkdownMessageProps {
  content: string
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownMessage
