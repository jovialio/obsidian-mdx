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

declare module 'code-hike-css' {
  const content: string
  export default content
}
