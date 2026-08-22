declare module 'react-dom/client' {
  interface Root {
    render(element: never): void
  }
  export function createRoot(container: Element): Root
}

declare module 'renderer-script' {
  const content: string
  export default content
}

declare module 'mermaid-renderer-script' {
  const content: string
  export default content
}
